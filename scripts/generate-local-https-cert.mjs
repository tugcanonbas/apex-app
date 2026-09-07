import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = new Map(
	process.argv.slice(2).map((arg, index, all) => {
		if (!arg.startsWith('--')) return [arg, ''];
		const [key, inlineValue] = arg.split('=');
		return [key.slice(2), inlineValue ?? all[index + 1] ?? ''];
	})
);

function shellOutput(command, commandArgs) {
	try {
		return execFileSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return '';
	}
}

function detectHost() {
	const networkHost = Object.values(os.networkInterfaces())
		.flat()
		.find((network) => network?.family === 'IPv4' && !network.internal && network.address.startsWith('192.168.'))?.address;
	return (
		args.get('host') ||
		networkHost ||
		Object.values(os.networkInterfaces())
			.flat()
			.find((network) => network?.family === 'IPv4' && !network.internal)?.address ||
		shellOutput('ipconfig', ['getifaddr', 'en0']) ||
		shellOutput('ipconfig', ['getifaddr', 'en1']) ||
		'127.0.0.1'
	);
}

function runOpenSsl(commandArgs) {
	execFileSync('openssl', commandArgs, { stdio: 'inherit' });
}

const host = detectHost();
const certDir = path.resolve('data/certs');
const caKeyPath = path.join(certDir, 'verde-local-ca.key');
const caCertPath = path.join(certDir, 'verde-local-ca.pem');
const serverKeyPath = path.join(certDir, 'verde-local.key');
const serverCsrPath = path.join(certDir, 'verde-local.csr');
const serverCertPath = path.join(certDir, 'verde-local.crt');
const extPath = path.join(certDir, 'verde-local.ext');

mkdirSync(certDir, { recursive: true });

if (!existsSync(caKeyPath) || !existsSync(caCertPath)) {
	runOpenSsl([
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-sha256',
		'-days',
		'825',
		'-nodes',
		'-keyout',
		caKeyPath,
		'-out',
		caCertPath,
		'-subj',
		'/CN=VERDE Local Dev CA'
	]);
}

writeFileSync(
	extPath,
	[
		'authorityKeyIdentifier=keyid,issuer',
		'basicConstraints=CA:FALSE',
		'keyUsage=digitalSignature,keyEncipherment',
		'extendedKeyUsage=serverAuth',
		'subjectAltName=@alt_names',
		'',
		'[alt_names]',
		'DNS.1=localhost',
		`IP.1=${host}`,
		'IP.2=127.0.0.1',
		''
	].join('\n')
);

runOpenSsl([
	'req',
	'-new',
	'-newkey',
	'rsa:2048',
	'-nodes',
	'-keyout',
	serverKeyPath,
	'-out',
	serverCsrPath,
	'-subj',
	`/CN=${host}`
]);

runOpenSsl([
	'x509',
	'-req',
	'-in',
	serverCsrPath,
	'-CA',
	caCertPath,
	'-CAkey',
	caKeyPath,
	'-CAcreateserial',
	'-out',
	serverCertPath,
	'-days',
	'825',
	'-sha256',
	'-extfile',
	extPath
]);

console.log(`Generated VERDĒ local HTTPS certificate for ${host}`);
console.log(`Server certificate: ${serverCertPath}`);
console.log(`Server key: ${serverKeyPath}`);
console.log(`Install and fully trust this CA on the iPhone: ${caCertPath}`);
