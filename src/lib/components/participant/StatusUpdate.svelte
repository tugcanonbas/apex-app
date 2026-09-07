<script lang="ts">
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { IconName } from './rideTypes';

	let {
		isAdaptive,
		title,
		body,
		update,
		tone = 'neutral',
		icon = 'progress'
	}: {
		isAdaptive: boolean;
		title: string;
		body: string;
		update?: string;
		tone?: 'neutral' | 'route' | 'wait' | 'delay' | 'boarding' | 'arrival';
		icon?: IconName;
	} = $props();
</script>

<section
	class="border-t border-(--hairline) py-4"
	class:aic-status={isAdaptive}
	class:aic-delay={isAdaptive && tone === 'delay'}
	class:aic-arrival={isAdaptive && (tone === 'arrival' || tone === 'boarding')}
	data-log-target="status_update"
	data-log-type={tone}
	data-log-surface="status_update"
>
	<div class:mx-4={isAdaptive} class="flex items-start gap-3">
		<div
			class="grid h-10 w-10 shrink-0 place-items-center rounded-full"
			class:bg-attention={isAdaptive && tone === 'delay'}
			class:bg-forest={isAdaptive && (tone === 'arrival' || tone === 'boarding')}
			class:bg-mint={isAdaptive && tone !== 'delay' && tone !== 'arrival' && tone !== 'boarding'}
			class:bg-canvas-mist={!isAdaptive}
			class:text-white={isAdaptive &&
				(tone === 'delay' || tone === 'arrival' || tone === 'boarding')}
			class:text-forest={!isAdaptive ||
				(tone !== 'delay' && tone !== 'arrival' && tone !== 'boarding')}
		>
			<VerdeIcon name={icon} size={20} />
		</div>
		<div>
			<h2
				class="font-bold"
				class:text-2xl={isAdaptive && tone === 'delay'}
				class:text-xl={!isAdaptive || tone !== 'delay'}
				class:text-[#745116]={isAdaptive && tone === 'delay'}
				class:text-forest={!isAdaptive || tone !== 'delay'}
			>
				{title}
			</h2>
			<p class="mt-2 text-sm leading-6 font-semibold text-[#263C34]">{body}</p>
			{#if isAdaptive && update}
				<p class="mt-3 text-xs font-bold tracking-[0.12em] text-corduroy uppercase">Why now</p>
				<p class="mt-1 text-sm leading-5 text-[#263C34]">{update}</p>
			{/if}
		</div>
	</div>
</section>

<style>
	.aic-status {
		position: relative;
		border-top-color: rgba(54, 129, 108, 0.35);
	}

	.aic-status::before {
		content: '';
		position: absolute;
		inset: 1rem auto 1rem 0;
		width: 4px;
		border-radius: 999px;
		background: #36816c;
	}

	.aic-delay {
		border-top-color: rgba(184, 137, 58, 0.65);
	}

	.aic-delay::before {
		background: #b8893a;
	}

	.aic-arrival::before {
		background: #14422e;
	}
</style>
