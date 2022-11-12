<script>
  import { get } from 'svelte/store'
  import { onMount, onDestroy } from 'svelte'
  import algosdk from 'algosdk'
  import { token, server, port, algod } from '../stores/algod.js'
  import { handle, wallet_address } from '../stores/wallet.js'
  import Wallet from '../lib/Wallet.svelte'
  import Transaction from '../lib/Transaction.svelte'

  import AlgoSignerLogo from '../assets/algosigner.svg'

  let tracking
  let current_round

  let txn_file
  let txn
  let txns = []
  let txn_size = 1
  let active_app
  let app_id = 100 //7 //1039 //987 //972 //947 //942 //912 //542
  let global_states = {}
  let userState = {}
  let liveState = {}
  let txn_sender
  let txn_first_valid
  let txn_last_valid

  const MAX_SIGNERS = 8
  let signers = []
  let accounts = []
  let threshold
  let version = 1
  let signed
  let msig_address
  let submit_enabled
  let msig_state_changed = false
  let msig_txns

  $: threshold, calc_msig_addr()

  const abi = {
    "name": "On-Chain Msig Signer",
    "networks": {},
    "methods": [
      {
        "name": "deploy",
        "desc": "Deploy a new On-Chain Msig Application",
        "args": [
          { "type": "uint8", "name": "VersionMajor", "desc": "Major version number" },
          { "type": "uint8", "name": "VersionMinor", "desc": "Minor version number" }
        ],
        "returns": { "type": "uint64", "desc": "Application ID" }
      },
      {
        "name": "setSignatures",
        "desc": "Set signatures for account",
        "args": [
          { "type": "byte[][]", "name": "Signatures", "desc": "Array of signatures" }
        ],
        "returns": { "type": "void" }
      },
      {
        "name": "clearSignatures",
        "desc": "Clear signatures for account",
        "args": [],
        "returns": { "type": "void" }
      },
      {
        "name": "addAccount",
        "desc": "Add account to multisig",
        "args": [
          { "type": "uint8", "name": "Index", "desc": "Account position within multisig" },
          { "type": "account", "name": "Account", "desc": "Account to add" }
        ],
        "returns": { "type": "void" }
      },
      {
        "name": "removeAccount",
        "desc": "Remove account from multisig",
        "args": [
          { "type": "account", "name": "Account", "desc": "Account to remove" }
        ],
        "returns": { "type": "void" }
      },
      {
        "name": "addTransaction",
        "desc": "Add transaction to the app",
        "args": [
          { "type": "uint8", "name": "Group Index", "desc": "Transactions position within an atomic group" },
          { "type": "byte[]", "name": "Transaction", "desc": "Transaction to add" }
        ],
        "returns": { "type": "void" }
      },
      {
        "name": "removeTransaction",
        "desc": "Remove transaction from the app",
        "args": [
          { "type": "uint8", "name": "Group Index", "desc": "Transactions position within an atomic group" }
        ],
        "returns": { "type": "void" }
      },
      {
        "name": "destroy",
        "desc": "Destroy the application",
        "args": [],
        "returns": { "type": "void" }
      },
      {
        "name": "update",
        "desc": "Update the application",
        "args": [
          { "type": "uint8", "name": "VersionMajor", "desc": "Major version number" },
          { "type": "uint8", "name": "VersionMinor", "desc": "Minor version number" }
        ],
        "returns": { "type": "void" }
      }
    ]
  }
  const contract = new algosdk.ABIContract(abi)

  async function track_round() {
    if (!tracking) return
    try {
      const status = await $algod.statusAfterBlock(current_round).do()
      current_round = status['last-round']
      check_for_app_changes(current_round, app_id)
      track_round()
    } catch {
      tracking = false
    }
  }

  async function check_for_app_changes(rnd, apid) {
    try {
      const block = await $algod.block(rnd).do()
      if (block['block']['txns'] === undefined) return
      block['block']['txns'].forEach(async (txn) => {
        if (txn['txn']['type'] !== "appl") return
        if (txn['txn']['apid'] !== apid) return

        console.log(txn)
        // Check for state changes
        await getAppState(apid)

        // Check for box update
        console.log("Txns: " + msig_txns)
        if (txn['txn']['apbx'] !== undefined) {
          await get_txn_boxes(apid)
        }
      })
    } catch {}
  }

  async function update_algod_settings() {
    $algod = new algosdk.Algodv2($token, $server, $port)
  }

  async function get_txn_boxes(apid) {
    const boxes = await $algod.getApplicationBoxes(apid).do()
    if (boxes['boxes'].length > 0) {
      boxes['boxes'].forEach(async (bx) => {
        const box = await $algod.getApplicationBoxByName(apid, box_name).do()
        liveState['txns'].push(algosdk.decodeUnsignedTransaction(box.value))
      })
    } else {
      liveState['txns'] = []
    }
    liveState = liveState
  }

  // userState = Current users changes
  // liveState = Latest blockchain state
  async function getAppState(apid) {
    const app = await $algod.getApplicationByID(apid).do()
    console.log(app)
    if (app['params']['global-state'] === undefined) return
    signers = []
    global_states = {}
    userState = {}
    userState['accounts'] = []
    liveState['accounts'] = []
    app['params']['global-state'].forEach((gs) => {
      const key = Buffer.from(gs['key'], 'base64')
      const val = gs['value']
      const value = val['type'] == 1 ? val['bytes'] : val['uint']
      if (key.length == 32 && algosdk.isValidAddress(algosdk.encodeAddress(key))) {
        liveState['accounts'][algosdk.encodeAddress(key)] = value
        global_states[algosdk.encodeAddress(key)] = value
        signers.push({addr: algosdk.encodeAddress(key), sig: value})
        calc_msig_addr()
      } else {
        liveState[key] = value
        global_states[key] = value
      }
    })
    console.log("liveState:")
    console.log(liveState)
    console.log("userState:")
    console.log(userState)
    if (userState['accounts'].length < 1) {
      userState['accounts'].push({addr: '', sig: ''})
    }
    userState = userState
    liveState = liveState
  }

  async function reconnect() {
    const status = await $algod.status().do()
    current_round = status['last-round']
    tracking = true
    track_round()
  }

  onMount(async () => {
    const status = await $algod.status().do()
    current_round = status['last-round']
    tracking = true
    track_round()
  })

  onDestroy(async () => {
    tracking = false
  })

  async function read_txn_file() {
    let file = this.files[0]
    txn_file = file.name
    let fileReader = new FileReader()
    fileReader.readAsArrayBuffer(file)
    fileReader.onload = function() {
      const file_contents = algosdk.decodeObj(fileReader.result)
      txn = file_contents['txn']
      document.getElementById('replace-transaction').disabled = false
    }
    fileReader.onerror = function() {
      alert(fileReader.error)
    }
  }

  async function replace_txn() {
    const txn_bin = algosdk.encodeObj(txn)
    const box = {appIndex: app_id, name: new Uint8Array(Buffer.from('txn'))}
    const method = contract.methods.filter(m => m.name == "addTransaction")[0]
    const sp = await $algod.getTransactionParams().do()
    const update_txn_txn = algosdk.makeApplicationCallTxnFromObject({
      from: $wallet_address,
      appIndex: app_id,
      appArgs: [
        method.getSelector(),
        txn_bin,
      ],
      boxes: [
        box,
      ],
      suggestedParams: sp,
    })
    const b64_txn = Buffer.from(algosdk.encodeObj(update_txn_txn.get_obj_for_encoding())).toString('base64')
    const update_txn_stxn = await $handle.signTxn([{txn: b64_txn}]);
    //const update_txn_stxn = await $handle.signTxns([{txn: b64_txn}])
    const res = await $algod.sendRawTransaction(Buffer.from(update_txn_stxn[0].blob, 'base64')).do()
  }

  async function fetch_app(apid) {
    await reset_state()
    await getAppState(apid)
    await get_txn_boxes(apid)
    console.log(liveState)
    active_app = apid
  }

  async function create_new() {
    const atc = new algosdk.AtomicTransactionComposer()
    const contract = new algosdk.ABIContract(abi)
    const signer = new algosdk.makeBasicAccountTransactionSigner($wallet_address)
    const method = contract.methods.filter(m => m.name == "deploy")[0]
    const version_major = 0
    const version_minor = 1
    const approval_prog = 'CCAGAQACBBAwJgMMVmVyc2lvbk1ham9yDFZlcnNpb25NaW5vcglUaHJlc2hvbGSABFIf8dA2GgASQAB2gAQcaqWPNhoAEkABX4AER2/KljYaABJAAauABPVl/dg2GgASQAETgAQoAjcDNhoAEkABIYAEKyMtkDYaABJAAKqABP5ItbQ2GgASQADUgAT2N6D4NhoAEkAAeoAEnIahhTYaABJAADOABGOuVTY2GgASQABEADEZIxJEMRgURCg2GgEXZyk2GgIXZyoiZ4AEFR98dTIIFlCwIkMxGYEFEkQxGEQxADIJEkSxIrIQMgmyBzIJsgmzIkMxGSUSRDEYRDEAMgkSRCg2GgEXZyk2GgIXZyJDMRkjEkQxGEQxADIJEkQqNhoBF2ciQzEZIxJEMRhEMQAyCRJENhoBiADfvEg2GgGIANc2GgIjWblENhoBiADKNhoCSSNZJEwkCFK/IkMxGSMSRDEYRDEAMgkSRDYaAYgAqLxIIkMxGSMSRDEYRDEAMgkSRDYaAhfAHDYaARdnIkMxGSMSRDEYRDEAMgkSRDYaARfAHGkiQzEZIxIxGSISEUQxGESIAKJENhoBI1k1ASM1ADEANAAWUQcINhoBJCQ0AAsIWTUCNhoBJDQCCFk1AzYaATQCJQhJNAMIUmY0ACIISTQBDED/yDEATIgAaSJDMRkjEjEZJBIRRDEYRIgASUQxACOIAFAiQ4oBAYADdHhui/8XjP+L/yEEDESL/4EJDUAAD4sAi/8hBQgWUQcIUEIAE4sAgAExi/+BChghBQgWUQcIUFCMAImKAAEjMggxAGVMSIwAiYoCAIv+i/8WUQcIaIv/IghJjP8hBAxA/+qJ'
    const clear_prog = 'CA=='
    const sp = await $algod.getTransactionParams().do()
    atc.addMethodCall({
      appID: 0,
      method: method,
      methodArgs: [
        version_major,
        version_minor
      ],
      approvalProgram: new Uint8Array(Buffer.from(approval_prog, 'base64')),
      clearProgram: new Uint8Array(Buffer.from(clear_prog, 'base64')),
      numGlobalByteSlices: 0,
      numGlobalInts: 11,
      numLocalByteSlices: 16,
      numLocalInts: 0,
      sender: $wallet_address,
      suggestedParams: sp,
    })
    const txns_to_sign = atc.buildGroup()
    /*
    //const res2 = await atc.execute()
    //console.log(res2)
    return
    const sign_txn_txn = algosdk.makeApplicationCreateTxnFromObject({
      from: $wallet_address,
      appArgs: [
        algosdk.ABIMethod.fromSignature("deploy(uint8,uint8,uint8)void").getSelector(),
        new Uint8Array(algosdk.encodeuint8),
      ],
      suggestedParams: sp,
    })
    */
    const b64_txn = Buffer.from(algosdk.encodeObj(txns_to_sign[0]['txn'].get_obj_for_encoding())).toString('base64')
    const update_txn_stxn = await $handle.signTxn([{txn: b64_txn}]);
    //const update_txn_stxn = await $handle.signTxns([{txn: b64_txn}])
    const { txId } = await $algod.sendRawTransaction(Buffer.from(update_txn_stxn[0].blob, 'base64')).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    history.back()
    console.log(res)
    app_id = res['application-index']
    fetch_app(app_id)
  }

  async function reset_state() {
    txn = undefined
    active_app = undefined
    msig_state_changed = false
    txn_file = undefined
  }

  async function remove_all_signatures() {
    const sp = await $algod.getTransactionParams().do()
    const sign_txn_txn = algosdk.makeApplicationCallTxnFromObject({
      from: $wallet_address,
      appIndex: app_id,
      accounts: signers.map(s => s.addr),
      appArgs: [
        new Uint8Array(Buffer.from('addAddr')),
      ],
      suggestedParams: sp,
    })
    const b64_txn = Buffer.from(algosdk.encodeObj(sign_txn_txn.get_obj_for_encoding())).toString('base64')
    const update_txn_stxn = await $handle.signTxn([{txn: b64_txn}]);
    //const update_txn_stxn = await $handle.signTxns([{txn: b64_txn}])
    const res = await $algod.sendRawTransaction(Buffer.from(update_txn_stxn[0].blob, 'base64')).do()
  }

  async function remove_signature() {
    const sp = await $algod.getTransactionParams().do()
    const sign_txn_txn = algosdk.makeApplicationCallTxnFromObject({
      from: $wallet_address,
      appIndex: app_id,
      accounts: [$wallet_address],
      appArgs: [
        new Uint8Array(Buffer.from('addAddr')),
      ],
      suggestedParams: sp,
    })
    const b64_txn = Buffer.from(algosdk.encodeObj(sign_txn_txn.get_obj_for_encoding())).toString('base64')
    const update_txn_stxn = await $handle.signTxn([{txn: b64_txn}]);
    //const update_txn_stxn = await $handle.signTxns([{txn: b64_txn}])
    const res = await $algod.sendRawTransaction(Buffer.from(update_txn_stxn[0].blob, 'base64')).do()
  }

  async function add_signature() {
    const txn_bin = Buffer.from(txns[0].toByte()).toString('base64')
    const addrs = []
    signers.forEach((signer) => {
      if (algosdk.isValidAddress(signer['addr'])) {
        addrs.push(signer['addr'])
      }
    })
    const msparams = {
      version: version,
      threshold: threshold,
      addrs: addrs,
    }
    const txn_bin_sig = await $handle.signTxn([{txn: txn_bin, msig: msparams, signers: [ $wallet_address ]}])
    //console.log(txn_bin_sig)
    //console.log(txn_bin_sig[0].blob)
    const signed_msig_txn = algosdk.decodeSignedTransaction(Buffer.from(txn_bin_sig[0].blob, 'base64'))
    //const txn_sig = algosdk.encodeObj(txn_bin_sig[0].blob)
    /*
    const signature = signed_msig_txn['msig']['subsig'].forEach((sig) => {
      if (sig['s'] !== undefined) {
        return sig['s']
      }
    })
    */
    const signature = signed_msig_txn['msig']['subsig'].filter(sig => sig.s !== undefined)[0]['s']
    const sp = await $algod.getTransactionParams().do()
    const sign_txn_txn = algosdk.makeApplicationCallTxnFromObject({
      from: $wallet_address,
      appIndex: app_id,
      accounts: [$wallet_address],
      appArgs: [
        new Uint8Array(Buffer.from('addSig')),
        new Uint8Array(Buffer.from(signature, 'base64')),
      ],
      suggestedParams: sp,
    })
    const b64_txn = Buffer.from(algosdk.encodeObj(sign_txn_txn.get_obj_for_encoding())).toString('base64')
    const update_txn_stxn = await $handle.signTxn([{txn: b64_txn}]);
    //const update_txn_stxn = await $handle.signTxns([{txn: b64_txn}])
    const res = await $algod.sendRawTransaction(Buffer.from(update_txn_stxn[0].blob, 'base64')).do()
  }

  async function submit_transaction() {
    const addrs = signers.map((s) => s.addr)
    let msig_txn = algosdk.createMultisigTransaction(txn, { version, threshold, addrs })
    //console.log(algosdk.decodeObj(msig_txn))
    //return
    const signed_txns = []
    signers.forEach(async (signer) => {
      if (signer.sig !== '') {
        signed_txns.push(algosdk.appendSignRawMultisigSignature(msig_txn, { version, threshold, addrs }, signer.addr, Buffer.from(signer.sig, 'base64')).blob)
      }
    })
    if (signed_txns.length > 1) {
      const merged_txns = algosdk.mergeMultisigTransactions(signed_txns)
      const res = await $algod.sendRawTransaction(merged_txns).do()
    } else {
      const res = await $algod.sendRawTransaction(signed_txns[0]).do()
    }
  }

  async function calc_msig_addr() {
    let valid = true
    if (signers.length < 1) return
    const addrs = []
    signers.forEach((signer) => {
      if (algosdk.isValidAddress(signer['addr'])) {
        addrs.push(signer['addr'])
      } else {
        msig_address = undefined
        valid = false
        return
      }
    })
    if (!valid) return
    if (!threshold) return
    if (!version) return
    if (addrs.length < 1) return
    const mparams = {
      version: version,
      threshold: threshold,
      addrs: addrs,
    }
    msig_address = algosdk.multisigAddress(mparams)
  }

  async function update_address(index, address) {
    msig_state_changed = true
    // Check to see if address has signature
    if (global_states[address]) {
      signers[index]['sig'] = global_states[address]
    } else {
      signers[index]['sig'] = ''
    }
    calc_msig_addr()
  }

  async function auto_submit() {
    submit_enabled = this.checked
  }

  async function txn_selection() {
    document.getElementById('txn-select').click()
  }

  async function add_address() {
    msig_state_changed = true
    if (userState['accounts'].length < MAX_SIGNERS) {
      userState['accounts'].push({addr:'', sig:''})
      userState = userState
      calc_msig_addr()
    }
  }

  async function remove_address(index) {
    msig_state_changed = true
    document.getElementById('add-address').disabled = false
    userState['accounts'].splice(index, 1)
    if (userState['Threshold'] > userState['accounts'].length) {
      userState['Threshold'] = signers.length
    }
    if (userState['accounts'].length < 1) {
      userState['accounts'].push({addr:'', sig:''})
      userState['Threshold'] = 1
      msig_address = undefined
    } else {
      calc_msig_addr()
    }
    userState = userState
    console.log(userState)
  }

  async function move_addr_up(index, e) {
    e.target.blur()
    if (index <= 0) return
    [userState['accounts'][index-1], userState['accounts'][index]] = [userState['accounts'][index], userState['accounts'][index-1]]
    calc_msig_addr()
  }

  async function move_addr_down(index, e) {
    e.target.blur()
    if (index >= userState['accounts'].length - 1) return
    [userState['accounts'][index], userState['accounts'][index+1]] = [userState['accounts'][index+1], userState['accounts'][index]]
    calc_msig_addr()
  }
</script>

<div class="window glass" style="min-width: 510px; max-width: 700px">
  <div class="title-bar">
    <div class="title-bar-text">On-Chain Msig Signer</div>
  </div>
  <div class="window-body has-space">
    <div class="field-row" style="justify-content: space-between">
    <Wallet />
    <div class="field-row" style="margin-top: 0">
    <a href="#settings" tabindex="-1"><button style="padding: 0; min-width: 26px; max-width: 26px">⚙️</button></a>
    </div>
    </div>
    <p>Msig Signer is a way to enable multiple signers of a multisig address to sign a given transaction entirely on-chain. Without the need to send transaction files around.</p>
    <fieldset>
      <legend>Application</legend>
      <div class="field-row">
        <label for="app-id">On-Chain Msig AppID:</label>
        <input id="app-id" type="number" min="1" step="1" bind:value={app_id} />
        <button on:click={() => fetch_app(app_id)}>Retrieve</button>
        {#if app_id && active_app}
        <button on:click={reset_state}>Clear</button>
        {:else}
        <div>or</div>
        <a href="#submitting-txn" tabindex="-1"><button on:click={create_new}>Create New</button></a>
        {/if}
      </div>
    </fieldset>
    {#if active_app}
    <fieldset>
      <legend>Transactions</legend>
      <div class="field-row">
      {#if txns}
      <ul class="tree-view has-container" style="width: 100%">
      <!--
      {#each Array(txn_size) as _, group_index}
      -->
      {#each txns as txn, group_index}
        <li>
          <details open={!group_index}>
          <summary>{txn_size > 1 ? 'Gtxn' : 'Txn'}{group_index}</summary>
          <Transaction txn={txn} />
          </details>
        </li>
      {/each}
      </ul>
      {/if}
      </div>
      <div class="field-row" style="justify-content: flex-end">
        <label for="txn-select">Replace Txn: {txn_file ? txn_file : '...'}</label>
        <button on:click={txn_selection}>Browse</button>
        <input id="txn-select" type="file" style="display: none" on:change={read_txn_file} />
        <button id="replace-transaction" on:click={replace_txn} disabled>Replace Transaction</button>
      </div>
    </fieldset>
    <fieldset>
      <legend>Multisignature</legend>
      <div class="field-row" style="justify-content: space-between">
      <div class="field-row" style="display: inline-flex">
        <label for="msig-version">Version:</label>
        <select id="msig-version" bind:value={version} disabled>
          <option value={1}>1</option>
        </select>
        <label for="msig-threshold">Threshold:</label>
        <select id="msig-threshold" bind:value={userState['Threshold']}>
          {#each Array(signers.length) as _, i (i)}
          <option value={i+1}>{i+1}</option>
          {/each}
        </select>
        <button id="add-address" on:click={add_address} disabled={signers.length >= MAX_SIGNERS}>Add Address</button>
      </div>
      <div class="field-row" style="margin-top: 0">
        <button type="submit" disabled={!msig_state_changed}>Update Application</button>
      </div>
      </div>
      {#each userState['accounts'] as signer, index}
      <div class="field-row">
      <input id={index} type="checkbox" checked={Buffer.from(signer['sig'], 'base64').length == 64} disabled />
      <label for={index}>Signed</label>
      <input type="text" maxlength="58" bind:value={signer['addr']} on:input={(e) => update_address(index, e.target.value)} style="width: 100%">
      <button on:click={() => remove_address(index)} disabled={userState['accounts'].length <= 0}>{userState['accounts'].length > 1 ? 'Remove' : 'Clear'}</button>
      <button on:click={(e) => move_addr_up(index, e)} style="min-width:14px; width: 14px; padding: 0" disabled={index <= 0}>U</button>
      <button on:click={(e) => move_addr_down(index, e)} style="min-width:14px; width: 14px; padding: 0" disabled={index >= userState['accounts'].length - 1}>D</button>
      </div>
      {/each}
      <div class="field-row">
        <p>Msig Address: {msig_address}</p><span>{msig_address == txn_sender ? '✅' : '❌'}</span>
      </div>
    </fieldset>
    <fieldset>
      <legend>Controls</legend>
      <div class="field-row">
        <p>Signing Account: {$wallet_address}</p>
      </div>
      <div class="field-row" style="justify-content: space-between">
      <div class="field-row" style="margin-top: 0">
        <button on:click={remove_all_signatures}>Remove All Signatures</button>
      </div>
      <div class="field-row" style="margin-top: 0">
        <button on:click={add_signature}>Add Signature</button>
        <button on:click={remove_signature}>Remove Signature</button>
      </div>
    </fieldset>
    <section class="field-row" style="justify-content: flex-end">
      <div class="field-row">
        <input id="auto-submit" type="checkbox" on:change={auto_submit} />
        <label for="auto-submit">Auto-Submit</label>
      </div>
      <a href="#submitting-txn" tabindex="-1"><button type="submit" on:click={submit_transaction} disabled={submit_enabled}>Submit Transaction</button></a>
    </section>
    {/if}
  </div>
  <div class="status-bar">
    {#if txn}
    <p class="status-bar-field">First Valid: {txn_first_valid} {current_round < txn_first_valid ? '🕗' : current_round < txn_last_valid ? '✅' : '❌'}</p>
    <p class="status-bar-field">Last Valid: {txn_last_valid} {current_round < txn_first_valid ? '🕗' : current_round < txn_last_valid ? '✅' : '❌'}</p>
    <p class="status-bar-field">Signed: {signers.filter(signer => signer.sig).length}/{threshold}</p>
    {/if}
    <p class="status-bar-field" style="justify-content: flex-end">{tracking ? 'Current Round: '+current_round : 'Stopped'}</p>
  </div>
</div>

<div class="window is-bright" id="submitting-txn" role="dialog" aria-labelledby="dialog-title">
  <div class="title-bar">
    <div class="title-bar-text" id="dialog-title">Transaction</div>
    <div class="title-bar-controls">
      <button aria-label="Close" onclick="history.back()"></button>
    </div>
  </div>
  <div class="window-body has-space">
    <h2 class="instruction instruction-primary">Submitting transaction...</h2>
    <div role="progressbar" class="marquee"></div>
  </div>
  <footer style="text-align: right">
    <button onclick="history.back()">Dismiss</button>
  </footer>
</div>

<div class="window" id="settings" role="dialog" aria-labelledby="dialog-title">
  <div class="title-bar">
    <div class="title-bar-text" id="dialog-title">Msig Share Settings</div>
    <div class="title-bar-controls">
      <button aria-label="Close" onclick="history.back()"></button>
    </div>
  </div>
  <div class="window-body has-space">
    <h2 class="instruction instruction-primary">Msig Share Settings</h2>
    <fieldset>
      <legend>Algod Settings</legend>
      <div class="field-row" style="justify-content: flex-end">
        <label for="algod-token">Token:</label>
        <input id="algod-token" type="text" style="width: 450px" bind:value={$token} maxlength="64" />
      </div>
      <div class="field-row" style="justify-content: flex-end">
        <label for="algod-server">Server:</label>
        <input id="algod-server" type="text" style="width: 450px" bind:value={$server} />
      </div>
      <div class="field-row" style="justify-content: flex-end">
        <label for="algod-port">Port:</label>
        <input id="algod-port" type="number" min="1" max="65535" step="1" style="width: 450px" bind:value={$port} />
      </div>
      <div class="field-row" style="justify-content: flex-end">
        <label>{tracking ? 'Connected ✅' : 'Disconnected ❌'}</label>
        <button on:click={reconnect}>Reconnect</button>
      </div>
    </fieldset>
  </div>
  <footer style="text-align: right">
    <button on:click={update_algod_settings}>Save</button>
    <button onclick="history.back()">Close</button>
  </footer>
</div>
