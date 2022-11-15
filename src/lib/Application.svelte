<script>
  import { algod } from '../stores/algod.js'
  import { handle, wallet_address } from '../stores/wallet.js'
  import { num_accounts, user_state, app, app_id, global_state, accounts, creator, approval_prog, clear_prog, abi } from '../stores/msig_app.js'
  import algosdk from 'algosdk'

  export let apid = 0
  $app_id = apid
  let app_addr
  $: $app_id, calc_app_address()
  let app_addr_bal = 0

  const contract = new algosdk.ABIContract($abi)

  async function calc_app_address() {
    if (!Number.isInteger($app_id)) {
      console.log("Invalid AppID")
      return
    }
    app_addr = algosdk.getApplicationAddress($app_id)
  }

  async function retrieve_app() {
    if (!$app_id) return
    try {
      const app = await $algod.getApplicationByID($app_id).do()
      $creator = app['params']['creator']
      const app_acct = await $algod.accountInformation(app_addr).do()
      app_addr_bal = app_acct['amount']
      $accounts = []
      app['params']['global-state'].forEach((gs) => {
        const k = Buffer.from(gs['key'], 'base64')
        const v = gs['value']
        if (k.length === 32 && algosdk.isValidAddress(algosdk.encodeAddress(k))) {
          $global_state[algosdk.encodeAddress(k)] = v['uint']
        } else if (k.length === 1) {
          //$global_state[k] = v['type'] === 1 ? v['bytes'] : v['uint']
          $accounts[algosdk.decodeUint64(k)] = algosdk.encodeAddress(new Uint8Array(Buffer.from(v['bytes'], 'base64')))
        } else {
          $global_state[k] = v['type'] === 1 ? v['bytes'] : v['uint']
        }
      })
      //$user_state['threshold'] = $global_state['Threshold']
      for (let idx = 0; idx < $accounts.length; idx++) {
        const acc_ls = await $algod.accountInformation($accounts[idx]).do()
        const ls = acc_ls['apps-local-state'].forEach((als) => {
          if (als.id === $app_id) {
            $global_state['sigs'][$accounts[idx]] = als['key-value'].map(kv => kv.value.bytes)
          }
        })
      }
      $num_accounts = $accounts.length
      $global_state['accounts'] = [...$accounts]
      const boxes = await $algod.getApplicationBoxes($app_id).do()
      if (boxes['boxes'].length > 0) {
        boxes['boxes'].forEach(async (bx) => {
          const box_name = Buffer.from(bx.name).toString()
          const box = await $algod.getApplicationBoxByName($app_id, box_name).do()
          const pos = parseInt(box_name.substring(3))
          $global_state['txns'][pos] = algosdk.decodeObj(box.value.subarray(2))
        })
      }
    } catch(e) {
      console.log(e)
      console.log(e.message)
    }
    $user_state = Object.assign({}, $global_state)
    $app = true
  }

  async function clear_app() {
    $app_id = undefined
    $app = undefined
    apid = undefined
    app_addr = undefined
    app_addr_bal = 0
    $accounts = []
    $creator = undefined
  }

  async function deploy_app() {
    const atc = new algosdk.AtomicTransactionComposer()
    const method = contract.methods.filter(m => m.name === "deploy")[0]

    const global_byteslices = 8
    const global_ints = 11
    const local_byteslices = 16
    const local_ints = 0

    const version_major = 0
    const version_minor = 1

    const sp = await $algod.getTransactionParams().do()
    atc.addMethodCall({
      appID: 0,
      sender: $wallet_address,
      method: method,
      methodArgs: [
        version_major,
        version_minor
      ],
      approvalProgram: new Uint8Array(Buffer.from($approval_prog, 'base64')),
      clearProgram: new Uint8Array(Buffer.from($clear_prog, 'base64')),
      numGlobalByteSlices: global_byteslices,
      numGlobalInts: global_ints,
      numLocalByteSlices: local_byteslices,
      numLocalInts: local_ints,
      suggestedParams: sp
    })

    const txn = Buffer.from(algosdk.encodeObj(atc.transactions[0]['txn'].get_obj_for_encoding())).toString('base64')
    const stxn = await $handle.signTxn([{txn: txn}])
    location = '#submitting-txn'
    const { txId } = await $algod.sendRawTransaction(Buffer.from(stxn[0].blob, 'base64')).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    console.log(res)
    history.back()
    retrieve_app(res['application-index'])
  }

  async function fund_app() {
    const sp = await $algod.getTransactionParams().do()
    const fund_txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: $wallet_address,
      to: app_addr,
      amount: 2000000,
      suggestedParams: sp
    })
    console.log(fund_txn)
    const txn = Buffer.from(algosdk.encodeObj(fund_txn.get_obj_for_encoding())).toString('base64')
    const stxn = await $handle.signTxn([{txn: txn}])
    console.log(stxn)
    const { txId } = await $algod.sendRawTransaction(Buffer.from(stxn[0].blob, 'base64')).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    console.log(res)
  }
</script>

<div class="field-row">
  <label for="app-id">On-Chain Msig AppID:</label>
  <input id="app-id" type="number" min="1" step="1" bind:value={$app_id} />
  <button on:click={retrieve_app}>Retrieve</button>
  {#if $app_id}
  <button on:click={clear_app}>Clear</button>
  {:else}
  <div>or</div>
  <button on:click={deploy_app}>Create New</button>
  {/if}
</div>
{#if $app && $wallet_address === $creator}
<div class="field-row">
  <label>Application Address:</label>
  <span>{app_addr}</span>
</div>
<div class="field-row">
  <label>MsigApp Balance:</label><span>{app_addr_bal / (10 ** 6)} Algo</span>
  <button on:click={fund_app}>Fund 2 Algo</button>
</div>
{/if}
