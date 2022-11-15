import { readable, writable } from 'svelte/store'

export const num_accounts = writable(1)
export const user_state = writable({
  txns: [],
  accounts: [],
  sigs: {}
})
export const global_state = writable({
  txns: [],
  accounts: [],
  sigs: {}
})
export const app = writable(undefined)
export const app_id = writable(undefined)
export const txns = writable({})
export const accounts = writable([])
export const msig_address = writable(undefined)
export const threshold = writable(1)
export const creator = writable(undefined)
export const approval_prog = readable('CCAGAQACBBAwJgMMVmVyc2lvbk1ham9yDFZlcnNpb25NaW5vcglUaHJlc2hvbGSABFIf8dA2GgASQAB2gAQcaqWPNhoAEkABeIAER2/KljYaABJAAcSABPVl/dg2GgASQAETgAS1W49HNhoAEkABO4AEKyMtkDYaABJAAKqABP5ItbQ2GgASQADUgAT2N6D4NhoAEkAAeoAEnIahhTYaABJAADOABGOuVTY2GgASQABEADEZIxJEMRgURCg2GgEXZyk2GgIXZyoiZ4AEFR98dTIIFlCwIkMxGYEFEkQxGEQxADIJEkSxIrIQMgmyBzIJsgmzIkMxGSUSRDEYRDEAMgkSRCg2GgEXZyk2GgIXZyJDMRkjEkQxGEQxADIJEkQqNhoBF2ciQzEZIxJEMRhEMQAyCRJENhoBiAD4vEg2GgGIAPA2GgIjWblENhoBiADjNhoCSSNZJEwkCFK/IkMxGSMSRDEYRDEAMgkSRDYaAYgAwbxIIkMxGSMSRDEYRDEAMgkSRCM2GgFlTEhBAAY2GgGIAQc2GgE2GgIXwBxnNhoCF8AcSWQiCGciQzEZIxJEMRhEMQAyCRJENhoBiADcIkMxGSMSMRkiEhFEMRhEiACiRDYaASNZNQEjNQAxADQAFlEHCDYaASQkNAALCFk1AjYaASQ0AghZNQM2GgE0AiUISTQDCFJmNAAiCEk0AQxA/8gxAEyIAGkiQzEZIxIxGSQSEUQxGESIAElEMQAjiABQIkOKAQGAA3R4bov/F4z/i/8hBAxEi/+BCQ1AAA+LAIv/IQUIFlEHCFBCABOLAIABMYv/gQoYIQUIFlEHCFBQjACJigABIzIIMQBlTEiMAImKAgCL/ov/FlEHCGiL/yIISYz/IQQMQP/qiYoBAIv/ZIv/aUlkIglJQAAFSGlCAAFniQ==')
export const clear_prog = readable('CA==')
export const abi = readable({
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
        { "type": "uint8", "name": "Index", "desc": "Account position within multisig to remove" }
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
      "name": "setThreshold",
      "desc": "Update the multisig threshold",
      "args": [
        { "type": "uint8", "name": "Threshold", "desc": "New multisignature threshold" }
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
})
