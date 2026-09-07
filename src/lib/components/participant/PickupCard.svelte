<script lang="ts">
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { RideOption, StudyPhase } from '$lib/types';

	let {
		phase,
		isAdaptive,
		focusOption
	}: {
		phase: StudyPhase;
		isAdaptive: boolean;
		focusOption?: RideOption;
	} = $props();
</script>

{#if phase !== 'arrival'}
	<article
		class="border-t border-[var(--hairline)] py-4"
		class:aic-focus-panel={isAdaptive && phase === 'near_arrival'}
	>
		<div class="flex items-start gap-3">
			<div
				class="grid h-10 w-10 shrink-0 place-items-center rounded-full text-forest"
				class:bg-mint={isAdaptive}
				class:bg-white={!isAdaptive}
				class:border={!isAdaptive}
				class:border-[var(--hairline)]={!isAdaptive}
			>
				<VerdeIcon name="navigation" size={24} />
			</div>
			<div>
				<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">Pickup point</p>
				<h2 class="mt-2 text-lg font-bold text-forest">{focusOption?.pickupPoint}</h2>
				<p class="mt-2 text-sm leading-5 text-corduroy">
					{focusOption?.walkMinutes} min walk from Current Location.
				</p>
			</div>
		</div>
	</article>
{/if}

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
