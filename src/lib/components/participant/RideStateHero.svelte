<script lang="ts">
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { StudyPhase } from '$lib/types';
	import type { JourneyStepState, RideCopy } from './rideTypes';

	let {
		copy,
		headline,
		body,
		phase,
		isAdaptive,
		journeySteps
	}: {
		copy: RideCopy;
		headline: string;
		body: string;
		phase: StudyPhase;
		isAdaptive: boolean;
		journeySteps: JourneyStepState[];
	} = $props();
</script>

<section class="py-2" class:aic-entrance={isAdaptive} class:aic-hero={isAdaptive}>
	<p class="text-xs font-bold tracking-[0.16em] text-corduroy uppercase">
		{copy.eyebrow}
	</p>
	<h1
		class="mt-2 font-bold text-forest"
		class:text-[2.75rem]={isAdaptive}
		class:leading-none={isAdaptive}
		class:text-3xl={!isAdaptive}
		class:leading-tight={!isAdaptive}
	>
		{headline}
	</h1>
	<p class="mt-3 text-sm leading-6 text-[#263C34]">{body}</p>
	<div class="mt-4 flex items-center gap-2 overflow-hidden">
		{#each journeySteps as step}
			<div class="min-w-0 flex-1 text-center">
				<div
					class="mx-auto grid h-6 w-6 place-items-center rounded-full border"
					class:border-leaf={step.state !== 'pending'}
					class:border-[var(--hairline)]={step.state === 'pending'}
					class:bg-forest={step.state === 'active' && isAdaptive}
					class:bg-mint={step.state === 'done' || (step.state === 'active' && !isAdaptive)}
					class:bg-white={step.state === 'pending'}
					class:text-white={step.state === 'active' && isAdaptive}
					class:text-forest={step.state !== 'active' || !isAdaptive}
				>
					<VerdeIcon name={step.state === 'done' ? 'check' : 'progress'} size={12} />
				</div>
				<p class="mt-1 truncate text-[0.65rem] font-bold text-corduroy">{step.label}</p>
			</div>
		{/each}
	</div>
</section>

<style>
	.aic-hero {
		border-left: 4px solid #36816c;
		padding-left: 1rem;
	}

	.aic-entrance {
		animation: aic-rise 560ms var(--ease-calm);
	}

	@keyframes aic-rise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
