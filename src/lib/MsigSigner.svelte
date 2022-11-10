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

  async function track_round() {
    if (!tracking) return
    try {
      const status = await $algod.statusAfterBlock(current_round).do()
      current_round = status['last-round']
      check_for_changes(current_round, app_id)
      track_round()
    } catch {
      tracking = false
    }
  }

  async function check_for_changes(rnd, apid) {
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
      if (txn['txn']['apbx'] !== undefined) {
        await getTxnBox(apid)
      }
    })
    } catch {}
  }

  async function update_settings() {
    $algod = new algosdk.Algodv2($token, $server, $port)
  }

  async function getTxnBox(apid) {
    txn = undefined
    const box = await $algod.getApplicationBoxByName(apid, 'txn').do()
    const len = box.value.length
    txn = algosdk.decodeUnsignedTransaction(box.value)
  }

  async function getAppState(apid) {
    const app = await $algod.getApplicationByID(apid).do()
    if (app['params']['global-state'] === undefined) return
    num_signers = 0
    signers = []
    global_states = {}
    app['params']['global-state'].forEach((gs) => {
      const key = Buffer.from(gs['key'], 'base64')
      const val = gs['value']
      const value = val['type'] == 1 ? val['bytes'] : val['uint']
      if (key.length == 32 && algosdk.isValidAddress(algosdk.encodeAddress(key))) {
        global_states[algosdk.encodeAddress(key)] = value
        signers.push({addr: algosdk.encodeAddress(key), sig: value})
        num_signers += 1
        calc_msig_addr()
      } else {
        global_states[key] = value
      }
    })
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

  let txn_file
  let txn
  let txn_size = 1
  let app_id = 542
  let global_states = {}
  let txn_sender
  let txn_first_valid
  let txn_last_valid

  const MAX_SIGNERS = 8
  let signers = []
  let num_signers = 0
  let threshold
  let version = 1
  let signed
  let msig_address
  let submit_enabled

  $: threshold, calc_msig_addr()

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
    console.log(txn)
    const txn_bin = algosdk.encodeObj(txn)
    console.log(txn_bin)
    console.log($wallet_address)
    const box = {appIndex: app_id, name: new Uint8Array(Buffer.from('txn'))}
    console.log(box)
    const sp = await $algod.getTransactionParams().do()
    const update_txn_txn = algosdk.makeApplicationCallTxnFromObject({
      from: $wallet_address,
      appIndex: app_id,
      appArgs: [
        new Uint8Array(Buffer.from('addTxn')),
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
    console.log(update_txn_stxn)
    return
    const res = await $algod.sendRawTransaction(Buffer.from(update_txn_stxn[0].blob, 'base64')).do()
    console.log(res)
  }

  async function fetch_app(apid) {
    await getAppState(apid)
    const boxes = await $algod.getApplicationBoxes(apid).do()
    if (boxes['boxes'].length == 0) return
    const box = await $algod.getApplicationBoxByName(apid, 'txn').do()
    await getTxnBox(apid)
    txn_sender = algosdk.encodeAddress(txn['from']['publicKey'])
    txn_first_valid = txn['firstRound']
    txn_last_valid = txn['lastRound']
  }

  async function reset_state() {
    txn = undefined
  }

  async function add_address() {
    if (num_signers < MAX_SIGNERS) {
      signers.push({addr:'', sig:''})
      num_signers += 1
      calc_msig_addr()
    }
    if (num_signers == MAX_SIGNERS) {
      this.disabled = true
    }
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
    console.log(update_txn_stxn)
    const res = await $algod.sendRawTransaction(Buffer.from(update_txn_stxn[0].blob, 'base64')).do()
    console.log(res)
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
    console.log(update_txn_stxn)
    const res = await $algod.sendRawTransaction(Buffer.from(update_txn_stxn[0].blob, 'base64')).do()
    console.log(res)
  }

  async function add_signature() {
    console.log(txn)
    const txn_bin = Buffer.from(txn.toByte()).toString('base64')
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
      console.log(sig)
      if (sig['s'] !== undefined) {
        return sig['s']
      }
    })
    */
    const signature = signed_msig_txn['msig']['subsig'].filter(sig => sig.s !== undefined)[0]['s']
    console.log($wallet_address)
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
    console.log(update_txn_stxn)
    const res = await $algod.sendRawTransaction(Buffer.from(update_txn_stxn[0].blob, 'base64')).do()
    console.log(res)
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
      console.log(res)
    } else {
      const res = await $algod.sendRawTransaction(signed_txns[0]).do()
      console.log(res)
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

  async function remove_address(index) {
    document.getElementById('add-address').disabled = false
    signers.splice(index, 1)
    num_signers -= 1
    if (threshold > num_signers) {
      threshold = signers.length
    }
    if (num_signers < 1) {
      signers.push({addr:'', sig:''})
      num_signers = 1
      threshold = 1
      msig_address = undefined
    } else {
      calc_msig_addr()
    }
  }

  async function move_addr_up(index, e) {
    e.target.blur()
    if (index <= 0) return
    [signers[index-1], signers[index]] = [signers[index], signers[index-1]]
    calc_msig_addr()
  }

  async function move_addr_down(index, e) {
    e.target.blur()
    if (index >= signers.length - 1) return
    [signers[index], signers[index+1]] = [signers[index+1], signers[index]]
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
        {#if txn}
        <button on:click={reset_state}>Clear</button>
        {:else}
        <div>or</div>
        <button on:click={reset_state}>Create New</button>
        {/if}
      </div>
    </fieldset>
    {#if txn}
    <fieldset>
      <legend>Transactions</legend>
      <div class="field-row">
      <ul class="tree-view has-container" style="width: 100%">
      {#each Array(txn_size) as _, group_index}
        <li>
          <details open={!group_index}>
          <summary>{txn_size > 1 ? 'Gtxn' : 'Txn'}{group_index}</summary>
          <Transaction txn={txn} />
          </details>
        </li>
      {/each}
      </ul>
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
        <label for="msig-version">Version</label>
        <select id="msig-version" bind:value={version} disabled>
          <option value={1}>1</option>
        </select>
        <label for="msig-threshold">Threshold</label>
        <select id="msig-threshold" bind:value={threshold}>
          {#each Array(num_signers) as _, i (i)}
          <option value={i+1}>{i+1}</option>
          {/each}
        </select>
        <button id="add-address" on:click={add_address}>Add Address</button>
      </div>
      </div>
      <!--
      <div class="field-row">
        <label>1</label>
        <input type="range" min="1" max="8" bind:value={num_signers} />
        <label>8</label>
      </div>
      <div class="field-row">
      </div>
      {#each Array(num_signers) as _, i (i)}
      {#each Object.entries(signers) as [addr, sig], index (index)}
      -->
      {#each Array(num_signers) as _, index (index)}
      <div class="field-row">
      <input id={signers[index]['addr']} type="checkbox" checked={Buffer.from(signers[index]['sig'], 'base64').length == 64} disabled />
      <label for={signers[index]['addr']}>Signed</label>
      <input type="text" maxlength="58" bind:value={signers[index]['addr']} on:input={(e) => update_address(index, e.target.value)} style="width: 100%">
      <button on:click={() => remove_address(index)}>Remove</button>
      <button on:click={(e) => move_addr_up(index, e)} style="min-width:14px; width: 14px; padding: 0" disabled={index <= 0}>U</button>
      <button on:click={(e) => move_addr_down(index, e)} style="min-width:14px; width: 14px; padding: 0" disabled={index >= num_signers - 1}>D</button>
      </div>
      {/each}
      <div class="field-row">
        <p>Msig Address: {msig_address}</p><span>{msig_address == txn_sender ? '✅' : '❌'}</span>
      </div>
    </fieldset>
    <fieldset>
      <legend>Controls</legend>
      <div class="field-row" style="display: inline-flex; margin-top: 0">
        <button on:click={add_signature}>Add Signature</button>
        <button on:click={remove_signature}>Remove Signature</button>
        <button on:click={remove_all_signatures}>Remove All Signatures</button>
      </div>
    </fieldset>
    <section class="field-row" style="justify-content: flex-end">
      <div class="field-row">
        <input id="auto-submit" type="checkbox" on:change={auto_submit} />
        <label for="auto-submit">Auto-Submit</label>
      </div>
      <a href="#submitting-txn" tabindex="-1"><button type="submit" on:click={submit_transaction} disabled={submit_enabled}>Submit Transaction</button></a>
      <button type="submit">Update Application</button>
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
        <label>{tracking ? 'Tracking' : 'Stopped'}</label>
        <button on:click={reconnect}>Reconnect</button>
      </div>
    </fieldset>
  </div>
  <footer style="text-align: right">
    <button on:click={update_settings}>Save</button>
    <button onclick="history.back()">Close</button>
  </footer>
</div>
