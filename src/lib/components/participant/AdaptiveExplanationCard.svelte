<script lang="ts">
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { StudyPhase } from '$lib/types';
	import type { IconName } from './rideTypes';

	let {
		phase,
		isAdaptive,
		title,
		body,
		update,
		icon
	}: {
		phase: StudyPhase;
		isAdaptive: boolean;
		title: string;
		body: string;
		update: string;
		icon: IconName;
	} = $props();
</script>

<section
	class="border-t border-[var(--hairline)] py-4"
	class:aic-entrance={isAdaptive}
	class:aic-guidance={isAdaptive}
	class:aic-pulse={isAdaptive && ['delay', 'near_arrival', 'arrival'].includes(phase)}
>
	<div class="flex items-start gap-3">
		<div
			class="grid h-10 w-10 shrink-0 place-items-center rounded-full"
			class:bg-attention={isAdaptive && phase === 'delay'}
			class:text-white={isAdaptive && phase === 'delay'}
			class:bg-mint={isAdaptive && phase !== 'delay'}
			class:bg-white={!isAdaptive}
			class:border={!isAdaptive}
			class:border-[var(--hairline)]={!isAdaptive}
			class:text-forest={phase !== 'delay' || !isAdaptive}
		>
			<VerdeIcon name={icon} size={22} />
		</div>
		<div>
			<p
				class="font-bold"
				class:text-attention={isAdaptive && phase === 'delay'}
				class:text-forest={phase !== 'delay' || !isAdaptive}
				class:text-xl={isAdaptive}
				class:text-sm={!isAdaptive}
			>
				{title}
			</p>
			<p
				class="mt-2 leading-6 text-[#263C34]"
				class:text-base={isAdaptive}
				class:text-sm={!isAdaptive}
			>
				{body}
			</p>
		</div>
	</div>
	<p
		class="mt-3 font-bold"
		class:text-attention={isAdaptive && phase === 'delay'}
		class:text-forest={isAdaptive && phase !== 'delay'}
		class:text-corduroy={!isAdaptive}
		class:text-sm={isAdaptive}
		class:text-xs={!isAdaptive}
	>
		{update}
	</p>
</section>

<style>
	.aic-guidance {
		position: relative;
		border-top-color: rgba(54, 129, 108, 0.35);
	}

	.aic-guidance::before {
		content: '';
		position: absolute;
		inset: 1rem auto 1rem 0;
		width: 4px;
		border-radius: 999px;
		background: #36816c;
	}

	.aic-entrance {
		animation: aic-rise 560ms var(--ease-calm);
	}

	.aic-pulse {
		animation: aic-pulse 1.8s var(--ease-calm) infinite;
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

	@keyframes aic-pulse {
		0%,
		100% {
			border-top-color: rgba(54, 129, 108, 0.36);
		}
		50% {
			border-top-color: rgba(184, 137, 58, 0.7);
		}
	}
</style>
