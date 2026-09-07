<script lang="ts">
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { RideOption, StudyPhase } from '$lib/types';

	let {
		phase,
		isAdaptive,
		isVehicleAssigned,
		focusOption,
		vehicleIdentifiers,
		vehicleIconClass,
		vehicleMediaClass,
		vehicleIdentifierClass,
		onOpenDetails
	}: {
		phase: StudyPhase;
		isAdaptive: boolean;
		isVehicleAssigned: boolean;
		focusOption?: RideOption;
		vehicleIdentifiers: string[];
		vehicleIconClass: string;
		vehicleMediaClass: string;
		vehicleIdentifierClass: string;
		onOpenDetails: () => void;
	} = $props();
</script>

<button
	class="block w-full border-t border-[var(--hairline)] px-3 py-4 text-left"
	class:aic-focus-panel={isAdaptive &&
		isVehicleAssigned &&
		['assignment', 'near_arrival', 'arrival'].includes(phase)}
	data-log-target="vehicle_card"
	data-log-type="vehicle_card"
	onclick={onOpenDetails}
>
	{#if isVehicleAssigned}
		<div class="flex items-start justify-between gap-3">
			<div>
				<p class="text-xs font-bold tracking-[0.16em] text-corduroy uppercase">Vehicle</p>
				<div class="mt-3 flex items-center gap-4 {vehicleMediaClass}">
					<img src="/shuttle-01.png" alt="" class="h-16 w-auto object-contain" />
					<div>
						<h2
							class="mt-2 font-bold text-forest"
							class:text-4xl={isAdaptive && ['near_arrival', 'arrival'].includes(phase)}
							class:text-2xl={!isAdaptive || !['near_arrival', 'arrival'].includes(phase)}
						>
							{focusOption?.vehicleId}
						</h2>
						<p class="mt-1 text-sm font-semibold text-corduroy">{focusOption?.vehicleType}</p>
					</div>
				</div>
			</div>
			<div class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl {vehicleIconClass}">
				<VerdeIcon name="vehicle" size={24} />
			</div>
		</div>
		<!-- <div class="mt-3 flex items-center gap-3 {vehicleMediaClass}"> -->
		<!-- <img src="/shuttle-01.png" alt="" class="h-16 w-auto object-contain" /> -->
		<!-- <p class="text-sm leading-5 font-semibold text-corduroy">
				Tap for capacity, battery, and comfort.
			</p> -->
		<!-- </div> -->
		{#if isAdaptive && (phase === 'near_arrival' || phase === 'arrival')}
			<div class="mt-4 grid gap-2">
				<p class="inline-flex items-center gap-2 text-sm font-bold {vehicleIdentifierClass}">
					<VerdeIcon name="shield" size={16} />
					<span>Vehicle ID: VERDE {focusOption?.vehicleId}</span>
				</p>
				<!-- {#each vehicleIdentifiers as identifier}
					<p class="inline-flex items-center gap-2 text-sm font-bold {vehicleIdentifierClass}">
						<VerdeIcon
							name={identifier.toLowerCase().includes('type') ? 'vehicle' : 'shield'}
							size={16}
						/>
						<span>
							{identifier}: {identifier.toLowerCase().includes('type')
								? focusOption?.vehicleType
								: focusOption?.vehicleId}
						</span>
					</p>
				{/each} -->
			</div>
		{/if}
	{:else}
		<div class="flex items-start gap-3">
			<div
				class="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--hairline)] bg-canvas-mist text-forest"
			>
				<VerdeIcon name="progress" size={24} />
			</div>
			<div>
				<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">Assignment</p>
				<h2 class="mt-2 text-2xl font-bold text-forest">Request received</h2>
				<p class="mt-2 text-sm leading-6 text-corduroy">
					VERDĒ is assigning your shuttle. Vehicle details appear next.
				</p>
			</div>
		</div>
	{/if}
</button>

<style>
	.aic-focus-panel {
		position: relative;
		border-top-color: rgba(54, 129, 108, 0.45);
	}

	.aic-focus-panel::before {
		content: '';
		position: absolute;
		inset: 1rem auto 1rem 0;
		width: 4px;
		border-radius: 999px;
		background: #36816c;
	}
</style>
