<script lang="ts">
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { RideOption } from '$lib/types';

	let {
		isAdaptive,
		isVehicleAssigned,
		focusOption,
		onClose
	}: {
		isAdaptive: boolean;
		isVehicleAssigned: boolean;
		focusOption?: RideOption;
		onClose: (method?: 'button' | 'backdrop') => void;
	} = $props();
</script>

<div
	class="fixed inset-0 z-40 flex items-end bg-forest/28 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm"
	role="button"
	tabindex="0"
	aria-label="Close vehicle details"
	data-log-target="vehicle_details_backdrop"
	data-log-type="modal_backdrop"
	data-log-surface="vehicle_details_sheet"
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
		class="mx-auto w-full max-w-107.5 rounded-[28px] border bg-white p-5 shadow-[0_-18px_50px_rgba(20,66,46,0.22)]"
		class:border-leaf={isAdaptive}
		class:border-[var(--hairline)]={!isAdaptive}
		data-log-target="vehicle_details_sheet"
		data-log-type="modal_sheet"
		data-log-surface="vehicle_details_sheet"
	>
		<div class="flex items-start justify-between gap-3">
			<div>
				<p class="text-xs font-bold tracking-[0.16em] text-corduroy uppercase">Vehicle details</p>
				<h2 class="mt-2 text-2xl font-bold text-forest">
					{isVehicleAssigned ? focusOption?.vehicleId : 'Assignment pending'}
				</h2>
			</div>
			<button
				class="verde-focus rounded-full border border-[var(--hairline)] bg-canvas-mist px-4 py-2 text-xs font-bold text-forest"
				data-log-target="vehicle_details_close"
				data-log-type="modal_close"
				onclick={() => onClose('button')}
			>
				Close
			</button>
		</div>

		<!-- Shuttle image (full width) -->
		{#if focusOption}
			<div class="mt-4">
				<img src="/shuttle-01.png" alt="" class="w-full rounded-xl object-cover" />
			</div>
		{/if}

		<div class="mt-5 grid gap-3">
			<div
				class="grid grid-cols-[auto_1fr] items-center gap-3 border-t border-[var(--hairline)] pt-3"
			>
				<VerdeIcon name="vehicle" size={18} />
				<div>
					<p class="text-[0.68rem] font-bold tracking-[0.14em] text-corduroy uppercase">Type</p>
					<p class="font-bold text-forest">
						{isVehicleAssigned ? focusOption?.vehicleType : 'Pending'}
					</p>
				</div>
			</div>
			<div
				class="grid grid-cols-[auto_1fr] items-center gap-3 border-t border-[var(--hairline)] pt-3"
			>
				<VerdeIcon name="users" size={18} />
				<div>
					<p class="text-[0.68rem] font-bold tracking-[0.14em] text-corduroy uppercase">Capacity</p>
					<p class="font-bold text-forest">
						{isVehicleAssigned ? focusOption?.occupancy : 'Pending'}
					</p>
				</div>
			</div>
			<div
				class="grid grid-cols-[auto_1fr] items-center gap-3 border-t border-[var(--hairline)] pt-3"
			>
				<VerdeIcon name="battery" size={18} />
				<div>
					<p class="text-[0.68rem] font-bold tracking-[0.14em] text-corduroy uppercase">Battery</p>
					<p class="font-bold text-forest">
						{isVehicleAssigned ? `${focusOption?.batteryPercent ?? 0}%` : 'Pending'}
					</p>
				</div>
			</div>
			<div
				class="grid grid-cols-[auto_1fr] items-center gap-3 border-t border-[var(--hairline)] pt-3"
			>
				<VerdeIcon name="seat" size={18} />
				<div>
					<p class="text-[0.68rem] font-bold tracking-[0.14em] text-corduroy uppercase">Comfort</p>
					<p class="font-bold text-forest">
						{isVehicleAssigned ? focusOption?.comfort : 'Pending'}
					</p>
				</div>
			</div>
		</div>
	</section>
</div>
