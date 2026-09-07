<script lang="ts">
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { JourneyStepState } from './rideTypes';

	let {
		isAdaptive,
		journeySteps,
		etaLabel,
		etaCaption,
		etaChangeLabel = '',
		etaTone = 'neutral',
		onOpenEtaDetails = () => undefined
	}: {
		isAdaptive: boolean;
		journeySteps: JourneyStepState[];
		etaLabel: string;
		etaCaption: string;
		etaChangeLabel?: string;
		etaTone?: 'neutral' | 'early' | 'delay';
		onOpenEtaDetails?: () => void;
	} = $props();
</script>

<section class="grid grid-cols-[1fr_auto] items-start gap-3" data-log-surface="ride_status_section">
	<div class="min-w-0" data-log-target="journey_progress" data-log-type="progress_indicator">
		<div class="flex items-start gap-2 overflow-hidden">
			{#each journeySteps as step (step.key)}
				<div class="min-w-0 flex-1">
					<div
						class="h-1.5 rounded-full"
						class:bg-forest={step.state === 'active'}
						class:bg-leaf={step.state === 'done'}
						class:bg-[var(--hairline)]={step.state === 'pending'}
					></div>
					<p
						class="mt-2 truncate text-[0.68rem] font-bold"
						class:text-forest={step.state !== 'pending'}
						class:text-corduroy={step.state === 'pending'}
					>
						{step.label}
					</p>
				</div>
			{/each}
		</div>
	</div>

	<button
		class="verde-focus min-w-[5.8rem] rounded-[18px] border px-3 py-2 text-right transition active:scale-[0.98]"
		class:border-[var(--hairline)]={!isAdaptive || etaTone === 'neutral'}
		class:bg-canvas-mist={!isAdaptive || etaTone === 'neutral'}
		class:border-[#E8D5A8]={isAdaptive && etaTone === 'delay'}
		class:bg-[#FFF8EA]={isAdaptive && etaTone === 'delay'}
		class:border-leaf={isAdaptive && etaTone === 'early'}
		class:bg-mint={isAdaptive && etaTone === 'early'}
		onclick={onOpenEtaDetails}
		aria-label="Open ETA details"
		data-log-target="eta_details_button"
		data-log-type="eta_card"
	>
		<p class="text-[0.65rem] font-bold tracking-[0.12em] text-corduroy uppercase">{etaCaption}</p>
		<p
			class="mt-0.5 text-2xl leading-none font-bold"
			class:text-[#745116]={isAdaptive && etaTone === 'delay'}
			class:text-forest={!isAdaptive || etaTone !== 'delay'}
		>
			{etaLabel}
		</p>
		<p
			class="mt-1 inline-flex min-h-4 items-center justify-end gap-1 text-xs font-bold"
			class:text-[#745116]={isAdaptive && etaTone === 'delay'}
			class:text-forest={!isAdaptive || etaTone !== 'delay'}
			aria-hidden={etaChangeLabel === ''}
		>
			<span class={etaChangeLabel === '' ? 'invisible' : ''} aria-hidden={etaChangeLabel === ''}>
				<VerdeIcon name={isAdaptive && etaTone === 'delay' ? 'alert' : 'clock'} size={12} />
			</span>
			{etaChangeLabel}
		</p>
	</button>
</section>
