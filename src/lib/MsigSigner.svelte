<script>
  import { onMount, onDestroy } from 'svelte'
  import { token, server, port, algod } from '../stores/algod.js'
  import { handle, wallet_address } from '../stores/wallet.js'
  import { num_accounts, user_state, app, app_id, global_state, txns, accounts, msig_address, creator, approval_prog, clear_prog, abi } from '../stores/msig_app.js'
  import { decodeMulti } from '@msgpack/msgpack'
  import algosdk from 'algosdk'
  import Wallet from '../lib/Wallet.svelte'
  import Transaction from '../lib/Transaction.svelte'

  let tracking
  let current_round

  const MAX_SIGNERS = 8
  let version = 1
  let msig_app

  const contract = new algosdk.ABIContract($abi)

  let msig_app_addr
  let app_addr_bal = 0
  //$: $app_id, calc_app_address()

  /*
  * 1 - Application
  */

  async function calc_app_address() {
    if (!Number.isInteger($app_id)) {
      console.log("Invalid AppID")
      return
    }
    msig_app_addr = algosdk.getApplicationAddress($app_id)
  }

  async function clear_app() {
    $app = undefined
    msig_app_addr = undefined
    $msig_address = undefined
    app_addr_bal = 0
    $accounts = []
    $creator = undefined
    $global_state = {
      txns: [],
      accounts: [],
      sigs: {}
    }
    $user_state = Object.assign({}, $global_state)
  }

  async function get_app_state() {
    const app = await $algod.getApplicationByID($app_id).do()
    $creator = app['params']['creator']
    const app_acct = await $algod.accountInformation(msig_app_addr).do()
    app_addr_bal = app_acct['amount']

    // Global state (inc. accounts)
    for (let gs = 0; gs < app['params']['global-state'].length; gs++) {
      const k = Buffer.from(app['params']['global-state'][gs]['key'], 'base64')
      const v = app['params']['global-state'][gs]['value']
      if (k.length === 32 && algosdk.isValidAddress(algosdk.encodeAddress(k))) {
        $global_state[algosdk.encodeAddress(k)] = v['uint']
      } else if (k.length === 1) {
        //$global_state[k] = v['type'] === 1 ? v['bytes'] : v['uint']
        $accounts[algosdk.decodeUint64(k)] = algosdk.encodeAddress(new Uint8Array(Buffer.from(v['bytes'], 'base64')))
      } else {
        $global_state[k] = v['type'] === 1 ? v['bytes'] : v['uint']
      }
    }

    // Populate sigs with accounts
    for (let idx = 0; idx < $accounts.length; idx++) {
      const acc_ls = await $algod.accountInformation($accounts[idx]).do()
      for (let als = 0; als < acc_ls['apps-local-state'].length; als++) {
        //console.log(acc_ls['apps-local-state'][als])
        if (!acc_ls['apps-local-state'][als]['key-value']) continue
        if (acc_ls['apps-local-state'][als].id === $app_id) {
          $global_state['sigs'][$accounts[idx]] = acc_ls['apps-local-state'][als]['key-value'].map(kv => kv.value.bytes)
        }
      }
    }
    if ($accounts.length) {
      $num_accounts = $accounts.length
    } else {
      $num_accounts = 1
    }
    $global_state['accounts'] = [...$accounts]
  }

  async function get_txn_from_boxes() {
    const boxes = await $algod.getApplicationBoxes($app_id).do()
    if (boxes['boxes'].length > 0) {
      for (let b = 0; b < boxes['boxes'].length; b++) {
        const box_name = Buffer.from(boxes['boxes'][b].name).toString()
        const box = await $algod.getApplicationBoxByName($app_id, box_name).do()
        const pos = parseInt(box_name.substring(3))
        //console.log(algosdk.decodeObj(box.value))
        $global_state['txns'][pos] = {txn: algosdk.decodeObj(box.value)}
      }
    }
  }

  async function retrieve_app() {
    if (!$app_id) return
    try {
      clear_app()
      calc_app_address()

      $accounts = []

      // Get application state
      await get_app_state()

      // Transactions (from Boxes)
      await get_txn_from_boxes()
    } catch(e) {
      console.log(e)
    }
    $user_state = Object.assign({}, $global_state)
    calc_msig_address()
    $app = true
  }

  async function check_for_app_changes(rnd, apid) {
    const block = await $algod.block(rnd).do()
    if (block['block']['txns'] === undefined) return
    for (let t = 0; t < block['block']['txns'].length; t++) {
      if (block['block']['txns'][t]['txn']['type'] !== "appl") return
      if (block['block']['txns'][t]['txn']['apid'] !== apid) return

      // Check for state changes
      await get_app_state()

      await get_txn_from_boxes()
    }
    $user_state = Object.assign({}, $global_state)
    calc_msig_address()
  }

  async function deploy_app() {
    clear_app()
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
    //console.log(res)
    history.back()
    $app_id = res['application-index']
    retrieve_app($app_id)
  }

  async function destroy_app() {
    console.log("destroying")
    const atc = new algosdk.AtomicTransactionComposer()
    const method = contract.methods.filter(m => m.name === "destroy")[0]

    const sp = await $algod.getTransactionParams().do()
    sp.flatFee = true
    sp.fee = algosdk.ALGORAND_MIN_TX_FEE * 2
    atc.addMethodCall({
      appID: $app_id,
      sender: $wallet_address,
      onComplete: algosdk.OnApplicationComplete.DeleteApplicationOC,
      method: method,
      methodArgs: [],
      suggestedParams: sp
    })

    const txn = Buffer.from(algosdk.encodeObj(atc.transactions[0]['txn'].get_obj_for_encoding())).toString('base64')
    const stxn = await $handle.signTxn([{txn: txn}])
    location = '#submitting-txn'
    const { txId } = await $algod.sendRawTransaction(Buffer.from(stxn[0].blob, 'base64')).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    //console.log(res)
    history.back()
    $app_id = undefined
    clear_app()
  }

  async function fund_app() {
    const sp = await $algod.getTransactionParams().do()
    const fund_txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: $wallet_address,
      to: msig_app_addr,
      amount: 2000000,
      suggestedParams: sp
    })
    const txn = Buffer.from(algosdk.encodeObj(fund_txn.get_obj_for_encoding())).toString('base64')
    const stxn = await $handle.signTxn([{txn: txn}])
    location = '#submitting-txn'
    const { txId } = await $algod.sendRawTransaction(Buffer.from(stxn[0].blob, 'base64')).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    history.back()
    //console.log(res)
    retrieve_app($app_id)
  }

  /*
  * Core
  */

  async function track_round() {
    if (!tracking) return
    try {
      const status = await $algod.statusAfterBlock(current_round).do()
      current_round = status['last-round']
      check_for_app_changes(current_round, $app_id)
      track_round()
    } catch {
      tracking = false
    }
  }

  async function update_algod_settings() {
    $algod = new algosdk.Algodv2($token, $server, $port)
  }

  async function algod_connect() {
    const status = await $algod.status().do()
    current_round = status['last-round']
    tracking = true
    track_round()
  }

  async function calc_msig_address() {
    if ($user_state['accounts'].length < 1) return
    for (let n = 0; n < $user_state['accounts'].length; n++) {
      if (!algosdk.isValidAddress($user_state['accounts'][n])) {
        console.log("Invalid account")
        $msig_address = "Invalid Multisig"
        return
      }
    }
    const mparams = {
      version: version,
      threshold: $user_state['Threshold'],
      addrs: $user_state['accounts'],
    }
    $msig_address = algosdk.multisigAddress(mparams)
  }

  async function update_threshold() {
    this.blur()
    calc_msig_address()
  }

  async function increase_accounts() {
    if ($num_accounts >= 8) {
      $num_accounts = 8
    } else {
      $num_accounts += 1
    }
  }

  async function reduce_accounts() {
    if ($num_accounts > 1 && $num_accounts > $user_state['accounts'].length) {
      $num_accounts -= 1
    }
    $user_state['accounts'] = $user_state['accounts']
  }

  async function remove_account(idx) {
    if (idx <= $user_state['accounts'].length) {
      $user_state['accounts'].splice(idx, 1)
      if ($user_state['accounts'].length <= $user_state['Threshold']) {
        if ($user_state['accounts'].length) {
          $user_state['Threshold'] = $user_state['accounts'].length
        } else {
          $user_state['Threshold'] = 1
        }
      }
    }
    $user_state['accounts'] = $user_state['accounts']
    calc_msig_address()
  }

  async function move_addr_up(addr_idx) {
    if (addr_idx < 1) return
    [$user_state['accounts'][addr_idx-1], $user_state['accounts'][addr_idx]] = [$user_state['accounts'][addr_idx], $user_state['accounts'][addr_idx-1]]
    calc_msig_address()
  }

  async function move_addr_down(addr_idx) {
    if (addr_idx >= $num_accounts - 1) return
    [$user_state['accounts'][addr_idx], $user_state['accounts'][addr_idx+1]] = [$user_state['accounts'][addr_idx+1], $user_state['accounts'][addr_idx]]
    calc_msig_address()
  }

  async function update_app() {
    const atc = new algosdk.AtomicTransactionComposer()
    const sp = await $algod.getTransactionParams().do()

    // Add Threshold Transaction
    if ($user_state['Threshold'] !== $global_state['Threshold']) {
      const method = contract.methods.filter(m => m.name === "setThreshold")[0]
      atc.addMethodCall({
        appID: $app_id,
        sender: $wallet_address,
        method: method,
        methodArgs: [
          $user_state['Threshold']
        ],
        suggestedParams: sp
      })
    }

    // Add Account Transactions
    if ($user_state['accounts'].length) {
      $num_accounts = $user_state['accounts'].length
    } else {
      $num_accounts = 1
    }
    const longest_length = $num_accounts > $accounts.length ? $num_accounts : $accounts.length
    for (let n = 0; n < longest_length; n++) {
      if ($user_state['accounts'][n] === $accounts[n]) continue
      if (n >= $user_state['accounts'].length) {
        // Remove Account
        const method = contract.methods.filter(m => m.name === "removeAccount")[0]
        atc.addMethodCall({
          appID: $app_id,
          sender: $wallet_address,
          method: method,
          methodArgs: [
            n
          ],
          suggestedParams: sp
        })
        continue
      }
      if (algosdk.isValidAddress($user_state['accounts'][n])) {
        const method = contract.methods.filter(m => m.name === "addAccount")[0]
        atc.addMethodCall({
          appID: $app_id,
          sender: $wallet_address,
          method: method,
          methodArgs: [
            n,
            $user_state['accounts'][n],
          ],
          suggestedParams: sp
        })
        continue
      } else {
        console.log("Invalid address detected")
        return
      }
    }
    if (!atc.transactions.length) {
      console.log("No update necessary")
      return
    }
    atc.buildGroup()
    //console.log(atc.transactions)
    const user_txns = []
    atc.transactions.forEach((txn) => {
      user_txns.push({txn: Buffer.from(algosdk.encodeObj(txn['txn'].get_obj_for_encoding())).toString('base64')})
    })
    //console.log(user_txns)
    const stxn = await $handle.signTxn(user_txns)
    const binSignedTxns = stxn.map((tx) => AlgoSigner.encoding.base64ToMsgpack(tx.blob));
    //console.log(binSignedTxns)
    location = '#submitting-txn'
    const { txId } = await $algod.sendRawTransaction(binSignedTxns).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    history.back()
    //console.log(res)
    //retrieve_app($app_id)
  }

  /*
  * 3 - Transactions
  */
  let txn_filename

  async function txn_browse() {
    document.getElementById('txn-select').click()
  }

  async function read_txn_file() {
    const file = this.files[0]
    if (file === undefined) {
      console.log("No file selected")
      txn_filename = undefined
      return
    }
    txn_filename = file.name
    const txn_reader = new FileReader()
    txn_reader.readAsArrayBuffer(file)
    txn_reader.onload = function() {
      const content = txn_reader.result
      let current_state = $user_state
      delete current_state['txns']
      const new_txns = []
      for (const gtxn of decodeMulti(Buffer.from(content))) {
        new_txns.push(gtxn)
      }
      //$user_state['txns'] = [...$user_state['txns']]
      current_state['txns'] = [...new_txns]
      user_state.update(us => current_state)
    }
    txn_reader.onerror = function() {
      console.log(txn_reader.error)
    }
  }

  async function replace_txns() {
    const atc = new algosdk.AtomicTransactionComposer()
    const sp = await $algod.getTransactionParams().do()

    const method = contract.methods.filter(m => m.name === "addTransaction")[0]

    for (let group_index = 0; group_index < $user_state['txns'].length; group_index++) {
      const box = {appIndex: $app_id, name: new Uint8Array(Buffer.from('txn'+group_index))}
      const transaction = algosdk.encodeObj($user_state['txns'][group_index])
      atc.addMethodCall({
        appID: $app_id,
        sender: $wallet_address,
        method: method,
        methodArgs: [
          group_index,
          transaction
        ],
        boxes: [
          box
        ],
        suggestedParams: sp
      })
    }
    atc.buildGroup()
    //console.log(atc.transactions)
    const user_txns = []
    atc.transactions.forEach((txn) => {
      user_txns.push({txn: Buffer.from(algosdk.encodeObj(txn['txn'].get_obj_for_encoding())).toString('base64')})
    })
    //console.log(user_txns)
    const stxn = await $handle.signTxn(user_txns)
    const binSignedTxns = stxn.map((tx) => AlgoSigner.encoding.base64ToMsgpack(tx.blob));
    const { txId } = await $algod.sendRawTransaction(binSignedTxns).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    //console.log(res)
  }

  async function clear_txns() {
    const atc = new algosdk.AtomicTransactionComposer()
    const sp = await $algod.getTransactionParams().do()

    const method = contract.methods.filter(m => m.name === "removeTransaction")[0]

    for (let group_index = 0; group_index < $global_state['txns'].length; group_index++) {
      const box = {appIndex: $app_id, name: new Uint8Array(Buffer.from('txn'+group_index))}
      atc.addMethodCall({
        appID: $app_id,
        sender: $wallet_address,
        method: method,
        methodArgs: [
          group_index
        ],
        boxes: [
          box
        ],
        suggestedParams: sp
      })
    }
    atc.buildGroup()
    //console.log(atc.transactions)
    const user_txns = []
    atc.transactions.forEach((txn) => {
      user_txns.push({txn: Buffer.from(algosdk.encodeObj(txn['txn'].get_obj_for_encoding())).toString('base64')})
    })
    //console.log(user_txns)
    const stxn = await $handle.signTxn(user_txns)
    const binSignedTxns = stxn.map((tx) => AlgoSigner.encoding.base64ToMsgpack(tx.blob));
    const { txId } = await $algod.sendRawTransaction(binSignedTxns).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    //console.log(res)
  }

  async function collapse_all_txns() {
    //console.log(document.getElementById('txn-view').children)
  }

  async function expand_all_txns() {
  }

  /*
  * 4 - Controls
  */
  async function sign_all() {
    const atc = new algosdk.AtomicTransactionComposer()
    const sp = await $algod.getTransactionParams().do()

    // Sign Transactions
    const msparams = {
      version: version,
      threshold: $user_state['Threshold'],
      addrs: $accounts
    }
    const txns_to_sign = $user_state['txns'].map(t => ({
      txn: Buffer.from(algosdk.encodeObj(t.txn)).toString('base64'),
      msig: msparams,
      signers: [ $wallet_address ]
    }))
    const signed_txns = await $handle.signTxn(
      txns_to_sign
    )

    const sigs = signed_txns.map(t => {
      return algosdk.decodeSignedTransaction(Buffer.from(t.blob, 'base64'))['msig']['subsig'].map(t => {
        return t.s
      }).filter(t => t !== undefined)
    })

    const output = []
    for (let s = 0; s < sigs.length; s++) {
      output.push(sigs[s][0])
    }
    //const output = [sigs[0][0], sigs[1][0], sigs[2][0]]

    // Submit Signatures
    const acc = await $algod.accountInformation($wallet_address).do()
    const acc_opted_in = acc['apps-local-state'].filter(apls => apls.id === $app_id).length > 0 ? true : false
    const optin_or_noop = acc_opted_in ? algosdk.OnApplicationComplete.NoOpOC : algosdk.OnApplicationComplete.OptInOC
    const method = contract.methods.filter(m => m.name === "setSignatures")[0]
    atc.addMethodCall({
      appID: $app_id,
      sender: $wallet_address,
      onComplete: optin_or_noop,
      method: method,
      methodArgs: [
        output
      ],
      suggestedParams: sp
    })
    atc.buildGroup()
    const user_txns = []
    atc.transactions.forEach((txn) => {
      user_txns.push({txn: Buffer.from(algosdk.encodeObj(txn['txn'].get_obj_for_encoding())).toString('base64')})
    })
    const stxn = await $handle.signTxn(user_txns)
    const binSignedTxns = stxn.map((tx) => AlgoSigner.encoding.base64ToMsgpack(tx.blob));
    location = '#submitting-txn'
    const { txId } = await $algod.sendRawTransaction(binSignedTxns).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    //console.log(res)
    history.back()
    //retrieve_app($app_id)
  }

  async function clear_sigs() {
    const atc = new algosdk.AtomicTransactionComposer()
    const sp = await $algod.getTransactionParams().do()

    const method = contract.methods.filter(m => m.name === "clearSignatures")[0]
    atc.addMethodCall({
      appID: $app_id,
      sender: $wallet_address,
      method: method,
      methodArgs: [],
      suggestedParams: sp
    })
    atc.buildGroup()
    const user_txns = []
    atc.transactions.forEach((txn) => {
      user_txns.push({txn: Buffer.from(algosdk.encodeObj(txn['txn'].get_obj_for_encoding())).toString('base64')})
    })
    const stxn = await $handle.signTxn(user_txns)
    const binSignedTxns = stxn.map((tx) => AlgoSigner.encoding.base64ToMsgpack(tx.blob));
    location = '#submitting-txn'
    const { txId } = await $algod.sendRawTransaction(binSignedTxns).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    //console.log(res)
    history.back()
    //retrieve_app($app_id)
  }

  async function clear_all_sigs() {
    console.log("TODO")
    return
    /*
    const atc = new algosdk.AtomicTransactionComposer()
    const sp = await $algod.getTransactionParams().do()

    const method = contract.methods.filter(m => m.name === "clearSignatures")[0]
    atc.addMethodCall({
      appID: $app_id,
      sender: $wallet_address,
      method: method,
      methodArgs: [],
      suggestedParams: sp
    })
    atc.buildGroup()
    const user_txns = []
    atc.transactions.forEach((txn) => {
      user_txns.push({txn: Buffer.from(algosdk.encodeObj(txn['txn'].get_obj_for_encoding())).toString('base64')})
    })
    const stxn = await $handle.signTxn(user_txns)
    const binSignedTxns = stxn.map((tx) => AlgoSigner.encoding.base64ToMsgpack(tx.blob));
    location = '#submitting-txn'
    const { txId } = await $algod.sendRawTransaction(binSignedTxns).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    //console.log(res)
    history.back()
    //retrieve_app($app_id)
    */
  }

  async function submit_transaction() {
    const atc = new algosdk.AtomicTransactionComposer()
    const sp = await $algod.getTransactionParams().do()

    // If not all signatures exist, don't proceed
    for (let acc in $accounts) {
      if (!$global_state['sigs'][$accounts[acc]] || $global_state['sigs'][$accounts[acc]].length < $global_state['txns'].length) {
        console.log("Missing signatures from " + $accounts[acc])
        //return
      }
    }

    // Sign Transactions
    const msparams = {
      version: version,
      threshold: $global_state['Threshold'],
      addrs: $accounts
    }

    let msig_txns = []
    for (let t = 0; t < $global_state['txns'].length; t++) {
      const single_txn = algosdk.decodeUnsignedTransaction(algosdk.encodeObj($global_state['txns'][t]['txn']))
      const txn = algosdk.createMultisigTransaction(single_txn, msparams)
      msig_txns.push(txn)
    }

    // Combine and merge all signatures
    let merged_signed_txns = []
    // For every txn in the group
    for (let m = 0; m < msig_txns.length; m++) {

      const signed_txns = []
      // For every account who has signed
      for (let acc in $global_state['sigs']) {
        signed_txns.push(algosdk.appendSignRawMultisigSignature(msig_txns[m], msparams, acc, Buffer.from($global_state['sigs'][acc][m], 'base64')).blob)
      }

      if (!signed_txns) {
        console.log("No signatures for txn" + m)
        return
      }

      if (signed_txns.length > 1) {
        merged_signed_txns.push(algosdk.mergeMultisigTransactions(signed_txns))
      } else {
        merged_signed_txns.push(signed_txns[0])
      }
    }

    // Submit Signed Transactions
    location = '#submitting-txn'
    const { txId } = await $algod.sendRawTransaction(merged_signed_txns).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    history.back()
    //console.log(res)
    //retrieve_app($app_id)

    return
  }

  onMount(async () => {
    algod_connect()
  })

  onDestroy(async () => {
    tracking = false
  })
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
    <p>Msig Signer is a way to enable multiple account holders of a multisig account to sign transactions entirely on-chain. Eliminating the hassle of sending transaction files around.</p>
    <fieldset>
      <legend>1 - Application</legend>
      {#if $wallet_address}
      <p>Retrieve an existing Msig Signer app, or create a new one.</p>
      {:else}
      <p>Retrieve an existing Msig Signer app.</p>
      {/if}
      <div class="field-row">
        <label for="app-id">On-Chain Msig AppID:</label>
        <input id="app-id" type="number" min="1" step="1" bind:value={$app_id} />
        <button on:click={retrieve_app}>Retrieve</button>
        <button on:click={clear_app}>Clear</button>
        <div>or</div>
        <button on:click={deploy_app}>Create New</button>
        {#if $app && $wallet_address === $creator}
        <button on:click={destroy_app}>Destroy</button>
        {/if}
      </div>
      {#if $app && $wallet_address === $creator}
      <div class="field-row">
        <label>Application Address:</label>
        <span>{msig_app_addr}</span>
      </div>
      <div class="field-row">
        <label>MsigApp Balance:</label><span>{app_addr_bal / (10 ** 6)} Algo</span>
        <button on:click={fund_app}>Fund 2 Algo</button>
      </div>
      {/if}
    </fieldset>
    {#if $app}
    <fieldset>
      <legend>2 - Multisignature</legend>
      {#if $app && $wallet_address === $creator}
      <p>Review the accounts that make up the multisig account along with their signed status. Modifying these fields (even the order) will result in a different multisig account.</p>
      {:else}
      <p>Review the accounts that make up the multisig account along with their signed status.</p>
      {/if}
      <div class="field-row" style="justify-content: space-between">
        <div class="field-row">
          <label for="msig-version">Version:</label>
          <select id="msig-version" disabled>
            <option>1</option>
          </select>
          <label for="msig-threshold">Threshold:</label>
          <select
            id="msig-threshold"
            bind:value={$user_state['Threshold']}
            on:change={update_threshold}
            disabled={$wallet_address !== $creator}
            class:changed={$user_state['Threshold'] !== $global_state['Threshold']}
          >
            {#each Array($user_state['accounts'].length ? $user_state['accounts'].length : 1) as _, index}
            <option>{index+1}</option>
            {/each}
          </select>
          {#if $wallet_address === $creator}
          <button id="add-account" on:click={increase_accounts} disabled={$num_accounts >= 8}>Increase Accounts</button>
          <button id="remove-account" on:click={() => reduce_accounts()} disabled={$num_accounts <= 1 || $num_accounts <= $user_state['accounts'].length}>Reduce Accounts</button>
          {/if}
        </div>
        {#if $app && $wallet_address === $creator}
        <div class="field-row" style="margin-top: 0">
          <button on:click={update_app}>Update Application</button>
        </div>
        {/if}
      </div>
      {#each Array($num_accounts) as _, index}
      <div class="field-row">
        <input id="" type="checkbox" disabled checked={$global_state['sigs'][$user_state['accounts'][index]] && $global_state['sigs'][$user_state['accounts'][index]].length === $user_state['txns'].length} />
        <label for="">Signed</label>
        <input
          id=""
          type="text"
          maxlength="58"
          style="width: 100%"
          bind:value={$user_state['accounts'][index]}
          on:input={calc_msig_address}
          class:changed={$accounts[index] !== $user_state['accounts'][index]}
          class:invalid={!algosdk.isValidAddress($user_state['accounts'][index])}
          readonly={$wallet_address !== $creator}
        />
        {#if $wallet_address === $creator}
        <button on:click={() => remove_account(index)}>Clear</button>
        <button style="min-width:14px; width: 14px; padding: 0" on:click={() => move_addr_up(index)} disabled={index <= 0}>U</button>
        <button style="min-width:14px; width: 14px; padding: 0" on:click={() => move_addr_down(index)} disabled={index >= $num_accounts-1}>D</button>
        {/if}
      </div>
      {/each}
      <div class="field-row">
        <p>Msig Address:</p><span>{$msig_address}</span>
      </div>
    </fieldset>
    <fieldset>
      <legend>3 - Transactions</legend>
      <div class="field-row" style="justify-content: space-between">
        <div class="field-row">
          {#if $app && $wallet_address === $creator}
          <p>Review the transaction(s) to be signed, or replace the transactions.</p>
          {:else}
          <p>Review the transaction(s) to be signed.</p>
          {/if}
        </div>
        <div class="field-row" style="margin-top: 0">
          <button on:click={expand_all_txns}>Expand All</button>
          <button on:click={collapse_all_txns}>Collapse All</button>
        </div>
      </div>
      <div class="field-row">
      <ul id="txn-view" class="tree-view has-container" style="width: 100%">
        {#each $user_state['txns'] as txn, index (txn)}
        <li>
          <details open={index === 0}>
          <summary>{$user_state['txns'].length > 1 ? 'Gtxn'+index : 'Txn'}</summary>
          <Transaction txn={txn} />
          </details>
        </li>
        {/each}
      </ul>
      </div>
      {#if $app && $wallet_address === $creator}
      <div class="field-row" style="justify-content: flex-end">
        <label for="txn-select">Replace Txn: <span>{txn_filename ? txn_filename : '...'}</span></label>
        <button on:click={txn_browse}>Browse</button>
        <input id="txn-select" type="file" style="display: none" on:change={read_txn_file} />
        <button id="replace-transaction" on:click={replace_txns} disabled={!txn_filename}>Replace Transaction</button>
        <button id="clear-transactions" on:click={clear_txns} disabled={$global_state['txns'].length < 1}>Clear Transactions</button>
      </div>
      {/if}
    </fieldset>
    {#if $wallet_address}
    <fieldset>
      <legend>4 - Controls</legend>
      <p>Use these controls to sign and submit your signatures. You will be presented with two signing windows, the first collects the signatures, the second submits them.</p>
      <div class="field-row">
        <p>Signing Account: {$wallet_address}</p>
      </div>
      <div class="field-row" style="">
        <button on:click={sign_all} disabled={$global_state['txns'].length < 1}>Sign All</button>
        <button on:click={clear_sigs}>Clear Signatures</button>
        {#if $wallet_address == $creator}
        <button on:click={clear_all_sigs}>Clear All Signatures</button>
        {/if}
      </div>
      {#if $global_state['txns'].length < 1}
      <div class="field-row">
        <p>No transactions to sign.</p>
      </div>
      {/if}
    </fieldset>
    {#if $wallet_address}
    <div class="field-row" style="justify-content: flex-end">
      <div class="field-row">
        <input id="auto-submit" type="checkbox" />
        <label for="auto-submit">Auto-Submit</label>
      </div>
      <a href="#submitting-txn" tabindex="-1"><button on:click={submit_transaction}>Submit Transaction</button></a>
    </div>
    {/if}
    {/if}
    {/if}
  </div>
  <div class="status-bar">
    <p class="status-bar-field">First Valid: {Math.max(...$user_state['txns'].map(t => t['txn']['fv']))} {current_round < Math.max(...$user_state['txns'].map(t => t['txn']['fv'])) ? '🕗' : current_round < Math.min(...$user_state['txns'].map(t => t['txn']['lv'])) ? '✅' : '❌'}</p>
    <p class="status-bar-field">Last Valid: {Math.min(...$user_state['txns'].map(t => t['txn']['lv']))} {current_round < Math.max(...$user_state['txns'].map(t => t['txn']['fv'])) ? '🕗' : current_round < Math.min(...$user_state['txns'].map(t => t['txn']['lv'])) ? '✅' : '❌'}</p>
    <p class="status-bar-field">Signed: {Object.entries($global_state['sigs']).length}/{$global_state['Threshold']}</p>
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
        <label for="">{tracking ? 'Connected ✅' : 'Disconnected ❌'}</label>
        <button id="" on:click={algod_connect}>Reconnect</button>
      </div>
    </fieldset>
  </div>
  <footer style="text-align: right">
    <button on:click={update_algod_settings}>Save</button>
    <button onclick="history.back()">Close</button>
  </footer>
</div>

<style>
  .changed {
    border: 1px solid orange;
  }
  .invalid {
    border: 1px solid red;
  }
</style>
