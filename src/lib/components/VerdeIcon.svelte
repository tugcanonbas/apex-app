<script lang="ts">
	let {
		name,
		size = 20,
		strokeWidth = 2.2,
		class: className = ''
	}: {
		name:
			| 'battery'
			| 'leaf'
			| 'users'
			| 'clock'
			| 'walk'
			| 'route'
			| 'shield'
			| 'check'
			| 'map'
			| 'bolt'
			| 'seat'
			| 'vehicle'
			| 'alert'
			| 'navigation'
			| 'headset'
			| 'id'
			| 'progress';
		size?: number;
		strokeWidth?: number;
		class?: string;
	} = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	aria-hidden="true"
>
	{#if name === 'battery'}
		<rect x="3" y="7" width="16" height="10" rx="2" />
		<path d="M21 11v2" />
		<path d="M6.5 10v4" />
		<path d="M10 10v4" />
		<path d="M13.5 10v4" />
		<path d="M17 10v4" />
	{:else if name === 'leaf'}
		<path d="M20 4c-8.2.4-13.1 3.5-14.8 9.3C4.2 17 6.4 20 10 20c5.8 0 9.4-5.6 10-16Z" />
		<path d="M5 19c2.9-5.6 7.2-9 13-10.2" />
	{:else if name === 'users'}
		<path d="M16 20v-1.4c0-2-1.6-3.6-3.6-3.6H7.6c-2 0-3.6 1.6-3.6 3.6V20" />
		<circle cx="10" cy="8" r="4" />
		<path d="M20 20v-1.4c0-1.7-1.1-3.1-2.7-3.5" />
		<path d="M16 4.3a4 4 0 0 1 0 7.4" />
	{:else if name === 'clock'}
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5l3 2" />
	{:else if name === 'walk'}
		<circle cx="13" cy="5" r="2" />
		<path d="M9 21l2-7" />
		<path d="M15 21l-2-5" />
		<path d="M8 11l3-3 3 2 2 4" />
		<path d="M6 14l3-3" />
	{:else if name === 'route'}
		<circle cx="6" cy="6" r="2.5" />
		<circle cx="18" cy="18" r="2.5" />
		<path d="M8.5 6H14a4 4 0 0 1 0 8h-4a4 4 0 0 0 0 8h5.5" />
	{:else if name === 'shield'}
		<path d="M12 3l7 3v5c0 4.4-2.7 8.2-7 10-4.3-1.8-7-5.6-7-10V6l7-3Z" />
		<path d="M9 12l2 2 4-5" />
	{:else if name === 'check'}
		<path d="M20 6 9 17l-5-5" />
	{:else if name === 'map'}
		<path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
		<path d="M9 3v15" />
		<path d="M15 6v15" />
	{:else if name === 'bolt'}
		<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
	{:else if name === 'seat'}
		<path d="M7 4h8a3 3 0 0 1 3 3v6H8a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2Z" />
		<path d="M5 13v5" />
		<path d="M18 13v5" />
		<path d="M7 18h12" />
	{:else if name === 'vehicle'}
		<rect x="4" y="7" width="16" height="10" rx="3" />
		<path d="M8 17v2" />
		<path d="M16 17v2" />
		<path d="M8 11h8" />
	{:else if name === 'alert'}
		<path d="M12 8v5" />
		<path d="M12 17h.01" />
		<path d="M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
	{:else if name === 'navigation'}
		<path d="m12 2 7 19-7-4-7 4 7-19Z" />
		<path d="M12 17V7" />
	{:else if name === 'headset'}
		<path d="M4 13v-1a8 8 0 0 1 16 0v1" />
		<path d="M18 17c0 2-2 3-5 3h-1" />
		<rect x="3" y="12" width="4" height="6" rx="2" />
		<rect x="17" y="12" width="4" height="6" rx="2" />
	{:else if name === 'id'}
		<rect x="3" y="5" width="18" height="14" rx="3" />
		<circle cx="9" cy="11" r="2" />
		<path d="M6.5 16c.7-1.4 1.6-2 2.5-2s1.8.6 2.5 2" />
		<path d="M14 10h4" />
		<path d="M14 14h4" />
	{:else if name === 'progress'}
		<circle cx="5" cy="12" r="2" />
		<circle cx="12" cy="12" r="2" />
		<circle cx="19" cy="12" r="2" />
		<path d="M7 12h3" />
		<path d="M14 12h3" />
	{/if}
</svg>
