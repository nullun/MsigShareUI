import { get, readable, writable } from 'svelte/store'
import algosdk from 'algosdk'

export let token = writable('a'.repeat(64))
//export let server = writable('http://192.168.1.148')
export let server = writable('http://127.0.0.1')
export let port = writable(4001)

export let algod = writable(new algosdk.Algodv2(get(token), get(server), get(port)))

