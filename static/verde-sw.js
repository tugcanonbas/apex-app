self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const targetUrl = event.notification.data?.url || '/app';
	event.waitUntil(
		self.clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((clients) => {
				const appClient = clients.find((client) => client.url.includes('/app'));
				if (appClient) {
					appClient.focus();
					return appClient.navigate(targetUrl);
				}
				return self.clients.openWindow(targetUrl);
			})
	);
});
