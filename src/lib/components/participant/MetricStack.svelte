<script lang="ts">
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { MetricItem } from './rideTypes';

	let {
		isAdaptive,
		metrics
	}: {
		isAdaptive: boolean;
		metrics: MetricItem[];
	} = $props();
</script>

<section class="border-t border-(--hairline) py-4" data-log-surface="ride_information">
	<h2 class="text-lg font-bold text-forest">Ride Information</h2>
	<div class="mt-3 grid grid-cols-3 gap-2">
		{#each metrics as metric (metric.icon)}
			<article
				class="min-w-0 rounded-[18px] border p-3"
				class:col-span-3={metric.icon === 'leaf'}
				class:aic-metric={isAdaptive && metric.icon === 'leaf'}
				class:aic-co2={isAdaptive && metric.icon === 'leaf'}
				data-log-target={`ride_metric:${metric.icon}`}
				data-log-type="ride_metric"
			>
				{#if metric.icon === 'leaf'}
					<div
						class="mb-2 grid h-8 w-8 place-items-center rounded-full text-forest"
						class:bg-mint={isAdaptive}
						class:bg-canvas-mist={!isAdaptive}
					>
						<VerdeIcon name="leaf" size={17} />
					</div>
					<p class="text-2xl font-bold text-forest">{metric.value} kg</p>
					<p class="mt-1 text-[0.68rem] font-bold text-corduroy">
						CO₂
					</p>
					{#if isAdaptive && (metric.changeLabel || metric.detailLabel)}
						<div class="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
							{#if metric.changeLabel}
								<span
									class="rounded-full px-2 py-1"
									class:bg-[#FFF8EA]={metric.tone === 'delay'}
									class:text-[#745116]={metric.tone === 'delay'}
									class:bg-mint={metric.tone !== 'delay'}
									class:text-forest={metric.tone !== 'delay'}
								>
									{metric.changeLabel}
								</span>
							{/if}
							{#if metric.detailLabel}
								<span class="text-corduroy">{metric.detailLabel}</span>
							{/if}
						</div>
					{/if}
				{:else}
					<div
						class="mb-2 grid h-8 w-8 place-items-center rounded-full text-forest"
						class:bg-mint={isAdaptive}
						class:bg-canvas-mist={!isAdaptive}
					>
						<VerdeIcon name={metric.icon} size={17} />
					</div>
					<p class="text-xl font-bold text-forest">{metric.value}</p>
					<p class="mt-1 text-[0.68rem] font-bold text-corduroy">{metric.label}</p>
				{/if}
			</article>
		{/each}
	</div>
</section>

<style>
	.aic-metric {
		border-color: rgba(54, 129, 108, 0.32);
		background: #f6faf8;
	}

	/* stronger emphasis for CO₂ metric when adaptive */
	.aic-metric.aic-co2 {
		border-color: rgba(54, 129, 108, 0.48);
		background: #e9fbf2;
	}
</style>
