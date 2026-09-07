<script lang="ts">
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';

	let {
		originalEta = 0,
		revisedEta = 0,
		delta = '',
		isAdaptive = false,
		onClose = () => undefined
	}: {
		originalEta?: number;
		revisedEta?: number;
		delta?: string;
		isAdaptive?: boolean;
		onClose?: (method?: 'button' | 'backdrop') => void;
	} = $props();

	let isDelay = $derived(delta.startsWith('+'));
</script>

<div
	class="fixed inset-0 z-40 flex items-end bg-forest/28 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm"
	role="button"
	tabindex="0"
	aria-label="Close ETA details"
	data-log-target="eta_details_backdrop"
	data-log-type="modal_backdrop"
	data-log-surface="eta_details_modal"
	onclick={(event) => {
		if (event.target === event.currentTarget) onClose('backdrop');
	}}
	onkeydown={(event) => {
		if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === 'Escape')) {
			onClose('backdrop');
		}
	}}
>
	<section
		class="mx-auto w-full max-w-[430px] rounded-[28px] border bg-white p-5 shadow-[0_-18px_50px_rgba(20,66,46,0.22)]"
		class:border-leaf={isAdaptive && !isDelay}
		class:border-[#E8D5A8]={isAdaptive && isDelay}
		class:border-[var(--hairline)]={!isAdaptive}
		role="dialog"
		aria-modal="true"
		data-log-target="eta_details_sheet"
		data-log-type="modal_sheet"
		data-log-surface="eta_details_modal"
	>
		<div class="flex items-start justify-between gap-3">
			<div>
				<p class="text-xs font-bold tracking-[0.16em] text-corduroy uppercase">ETA details</p>
				<h2 class="mt-2 text-2xl font-bold text-forest">Pickup timing</h2>
			</div>
			<button
				class="verde-focus rounded-full border border-[var(--hairline)] bg-canvas-mist px-4 py-2 text-xs font-bold text-forest"
				data-log-target="eta_details_close"
				data-log-type="modal_close"
				onclick={() => onClose('button')}
			>
				Close
			</button>
		</div>

		<div class="mt-5 grid gap-3">
			<div
				class="grid grid-cols-[auto_1fr] items-center gap-3 border-t border-[var(--hairline)] pt-3"
			>
				<VerdeIcon name="clock" size={18} />
				<div>
					<p class="text-[0.68rem] font-bold tracking-[0.14em] text-corduroy uppercase">
						Initial ETA
					</p>
					<p class="font-bold text-forest">{originalEta} min</p>
				</div>
			</div>

			<div
				class="grid grid-cols-[auto_1fr] items-center gap-3 border-t border-[var(--hairline)] pt-3"
			>
				<VerdeIcon name="progress" size={18} />
				<div>
					<p class="text-[0.68rem] font-bold tracking-[0.14em] text-corduroy uppercase">
						Updated ETA
					</p>
					<p class="font-bold text-forest">{revisedEta} min</p>
				</div>
			</div>

			<div
				class="grid grid-cols-[auto_1fr] items-center gap-3 border-t border-[var(--hairline)] pt-3"
			>
				<div
					class="grid h-8 w-8 place-items-center rounded-full"
					class:bg-[#FFF8EA]={isAdaptive && isDelay}
					class:bg-canvas-mist={!isAdaptive || !isDelay}
					class:text-[#745116]={isAdaptive && isDelay}
					class:text-forest={!isAdaptive || !isDelay}
				>
					<VerdeIcon name={isAdaptive && isDelay ? 'alert' : 'clock'} size={17} />
				</div>
				<div>
					<p class="text-[0.68rem] font-bold tracking-[0.14em] text-corduroy uppercase">Change</p>
					<p
						class="font-bold"
						class:text-[#745116]={isAdaptive && isDelay}
						class:text-forest={!isAdaptive || !isDelay}
					>
						{delta || '0 min'}
					</p>
				</div>
			</div>

			<p
				class="border-t border-[var(--hairline)] pt-3 text-sm leading-6 font-semibold text-corduroy"
			>
				{#if isDelay}
					Initial ETA is the booking estimate. Updated ETA follows the current pickup time.
				{:else}
					Initial ETA stays fixed. Updated ETA follows pickup.
				{/if}
			</p>
		</div>
	</section>
</div>
