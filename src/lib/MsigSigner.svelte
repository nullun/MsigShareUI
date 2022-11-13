<script>
  import { onMount, onDestroy } from 'svelte'
  import { token, server, port, algod } from '../stores/algod.js'
  import { handle, wallet_address } from '../stores/wallet.js'
  import { num_accounts, user_state, app, app_id, global_state, accounts, msig_address, creator, abi } from '../stores/msig_app.js'
  import algosdk from 'algosdk'
  import Wallet from '../lib/Wallet.svelte'
  import Application from '../lib/Application.svelte'
  import Transaction from '../lib/Transaction.svelte'

  let tracking
  let current_round

  const MAX_SIGNERS = 8
  let version = 1
  let msig_app

  const contract = new algosdk.ABIContract($abi)

  async function track_round() {
    if (!tracking) return
    try {
      const status = await $algod.statusAfterBlock(current_round).do()
      current_round = status['last-round']
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
      threshold: $user_state['threshold'],
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
      if ($user_state['accounts'].length <= $user_state['threshold']) {
        if ($user_state['accounts'].length) {
          $user_state['threshold'] = $user_state['accounts'].length
        } else {
          $user_state['threshold'] = 1
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
    if ($user_state['threshold'] !== $global_state['Threshold']) {
      const method = contract.methods.filter(m => m.name === "setThreshold")[0]
      atc.addMethodCall({
        appID: $app_id,
        sender: $wallet_address,
        method: method,
        methodArgs: [
          $user_state['threshold']
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
    console.log(atc.transactions)
    const txns = []
    atc.transactions.forEach((txn) => {
      txns.push({txn: Buffer.from(algosdk.encodeObj(txn['txn'].get_obj_for_encoding())).toString('base64')})
    })
    console.log(txns)
    const stxn = await $handle.signTxn(txns)
    const binSignedTxns = stxn.map((tx) => AlgoSigner.encoding.base64ToMsgpack(tx.blob));
    console.log(binSignedTxns)
    const { txId } = await $algod.sendRawTransaction(binSignedTxns).do()
    const res = await algosdk.waitForConfirmation($algod, txId, 6)
    console.log(res)
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
      <Application />
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
            bind:value={$user_state['threshold']}
            on:change={update_threshold}
            disabled={$wallet_address !== $creator}
            class:changed={$user_state['threshold'] !== $global_state['Threshold']}
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
        <input id="" type="checkbox" disabled />
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
      {#if $app && $wallet_address === $creator}
      <p>Review the transaction(s) to be signed, or replace the transactions.</p>
      {:else}
      <p>Review the transaction(s) to be signed.</p>
      {/if}
      <div class="field-row">
      <ul class="tree-view has-container" style="width: 100%">
        <li>
          <details>
          <summary></summary>
          <Transaction />
          </details>
        </li>
      </ul>
      </div>
      {#if $app && $wallet_address === $creator}
      <div class="field-row" style="justify-content: flex-end">
        <label for="txn-select">Replace Txn:</label>
        <button>Browse</button>
        <input id="txn-select" type="file" style="display: none" />
        <button id="replace-transaction" disabled>Replace Transaction</button>
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
        <button>Sign All</button>
        <button>Clear Signatures</button>
      </div>
    </fieldset>
    {#if $wallet_address}
    <div class="field-row" style="justify-content: flex-end">
      <div class="field-row">
        <input id="auto-submit" type="checkbox" />
        <label for="auto-submit">Auto-Submit</label>
      </div>
      <a href="#submitting-txn" tabindex="-1"><button type="submit">Submit Transaction</button></a>
    </div>
    {/if}
    {/if}
    {/if}
  </div>
  <div class="status-bar">
    <p class="status-bar-field">First Valid: {current_round < 0 ? '🕗' : current_round < 0 ? '✅' : '❌'}</p>
    <p class="status-bar-field">Last Valid: {current_round < 0 ? '🕗' : current_round < 0 ? '✅' : '❌'}</p>
    <p class="status-bar-field">Signed: 0/0</p>
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
