<script>
  import { onMount } from 'svelte'
  import algosdk from 'algosdk'
  export let txn = {}
  const pretty_txn = {}

  /*
  onMount(() => {
    console.log(txn)
    Object.entries(txn).forEach((field) => {
      switch (field[0]) {
        case 'type':
          pretty_txn['Type'] = field[1]
          break
        case 'rcv':
          pretty_txn['Receiver'] = algosdk.encodeAddress(field[1])
          break
        case 'to':
          pretty_txn['Receiver'] = algosdk.encodeAddress(field[1]['publicKey'])
          break
        case 'snd':
          pretty_txn['Sender'] = algosdk.encodeAddress(field[1])
          break
        case 'from':
          pretty_txn['Sender'] = algosdk.encodeAddress(field[1]['publicKey'])
          break
        case 'amt':
        case 'amount':
          pretty_txn['Amount'] = field[1]
          break
        case 'note':
          if (field[1].length > 0) {
            pretty_txn['Note'] = Buffer.from(field[1], 'base64')
          }
          break
        case 'lease':
          if (field[1].length > 0) {
            pretty_txn['Lease'] = Buffer.from(field[1], 'base64')
          } 
          break
        case 'gen':
        case 'genesisID':
          pretty_txn['Genesis'] = field[1]
          break
        case 'fv':
        case 'firstRound':
          pretty_txn['First Valid'] = field[1]
          break
        case 'lv':
        case 'lastRound':
          pretty_txn['Last Valid'] = field[1]
          break
        case 'fee':
          pretty_txn['Fee'] = field[1]
          break
        default:
      }
    })
    console.log(pretty_txn)
  })
  */
</script>

<ul>
{#each Object.entries(pretty_txn) as [field, value], index(field)}
  <li>{field}: {value}</li>
{/each}
</ul>
