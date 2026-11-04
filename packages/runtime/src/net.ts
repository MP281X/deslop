import {Array, Option, Result} from 'effect'

import {IpNetwork, NetAddress} from 'effect/net'

// The special-use ranges the internet never routes to; Effect names the common ones.
const BLOCKED = Array.map(
	[
		// IPv4: carrier-grade NAT, documentation, benchmarking, anycast and reserved.
		'0.0.0.0/8',
		'100.64.0.0/10',
		'192.0.0.0/24',
		'192.0.2.0/24',
		'192.31.196.0/24',
		'192.52.193.0/24',
		'192.88.99.0/24',
		'192.175.48.0/24',
		'198.18.0.0/15',
		'198.51.100.0/24',
		'203.0.113.0/24',
		'240.0.0.0/4',
		// IPv6: transition, documentation, anycast, segment routing and reserved.
		'100::/64',
		'2001::/23',
		'2001:db8::/32',
		'2002::/16',
		'2620:4f:8000::/48',
		'3fff::/20',
		'5f00::/16',
		'64:ff9b::/96',
		'64:ff9b:1::/48',
		'fec0::/10'
	],
	source => Result.getOrThrow(IpNetwork.fromString(source))
)

// A private IPv4 or a unique-local IPv6 address, the ranges only one family has.
function isHome(ip: NetAddress.IpAddress) {
	if (NetAddress.isIpv4Address(ip)) return NetAddress.isPrivate(ip)
	return NetAddress.isUniqueLocal(ip)
}

// An address the internet routes to, unlike the ranges a network keeps for itself.
export function isPublicIp(ip: NetAddress.IpAddress) {
	return (
		!NetAddress.isUnspecified(ip) &&
		!NetAddress.isLoopback(ip) &&
		!NetAddress.isLinkLocal(ip) &&
		!NetAddress.isMulticast(ip) &&
		!(NetAddress.isIpv4Address(ip) && NetAddress.isBroadcast(ip)) &&
		!isHome(ip) &&
		!Array.some(BLOCKED, network => IpNetwork.contains(network, ip))
	)
}

export function isIpAddress(address: string) {
	return Result.isSuccess(NetAddress.ipFromString(address))
}

// An address the internet routes to, with an IPv4-mapped IPv6 address read as that IPv4 address.
export function isPublicAddress(address: string) {
	return Option.exists(Result.getSuccess(NetAddress.ipFromString(address)), ip => {
		if (NetAddress.isIpv6Address(ip)) {
			return isPublicIp(Option.getOrElse(NetAddress.fromIpv4Mapped(ip), () => ip))
		}
		return isPublicIp(ip)
	})
}
