<script>
  import { handle, wallet_address } from '../stores/wallet.js'
  import MyAlgoConnect from '@randlabs/myalgo-connect';

  let connected
  let accounts
  let wallet_provider

  async function select_wallet() {
    try {
    switch (wallet_provider) {
      case 'AlgoSigner':
        await connect_wallet_algosigner()
        break
      case 'MyAlgo':
        await connect_wallet_myalgo()
        break
    }
    } catch {
      accounts = []
      wallet_provider = 'Connect Wallet'
      $wallet_address = undefined
      connected = false
    }
  }

  async function connect_wallet_algosigner() {
    $handle = AlgoSigner
    await $handle.connect()
    accounts = await $handle.accounts({ledger: 'SandNet'})
    connected = true
  }

  async function connect_wallet_myalgo() {
    $handle = new MyAlgoConnect();
    accounts = await $handle.connect()
    connected = true
  }

  async function disconnect_wallet() {
    accounts = []
    wallet_provider = 'Connect Wallet'
    $wallet_address = undefined
    connected = false
  }
</script>

<div class="field-row">
{#if connected}
  <select id="wallet-address" bind:value={$wallet_address}>
  {#each accounts as account}
    <option>{account.address}</option>
  {/each}
  </select>
  <button on:click={disconnect_wallet}>Disconnect</button>
{:else}
  <select bind:value={wallet_provider} on:change={select_wallet}>
    <option>Connect Wallet</option>
    <option>AlgoSigner</option>
    <option disabled>MyAlgo</option>
  </select>
{/if}
</div>
