<script lang="ts">
	import RouteMap from '$lib/components/RouteMap.svelte';
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { RideOption, RouteMapInteractionPayload, RouteMapViewState } from '$lib/types';
	import type { BookingOptionView, RouteMapViewProps } from './rideTypes';

	let {
		isAdaptive,
		recommendedDestination,
		routeMapProps,
		options,
		selectedOption,
		hasSelection,
		hasRequestedRide,
		onOpenMap,
		onMapInteraction = () => undefined,
		viewState = null,
		onViewStateChange = () => undefined,
		onSelectOption,
		onAutoSelectOption = onSelectOption,
		onRequestRide
	}: {
		isAdaptive: boolean;
		recommendedDestination?: string;
		routeMapProps: RouteMapViewProps;
		options: BookingOptionView[];
		selectedOption?: RideOption;
		hasSelection: boolean;
		hasRequestedRide: boolean;
		onOpenMap: (source: string) => void;
		onMapInteraction?: (payload: RouteMapInteractionPayload) => void;
		viewState?: RouteMapViewState | null;
		onViewStateChange?: (state: RouteMapViewState) => void;
		onSelectOption: (option: RideOption) => void;
		onAutoSelectOption?: (option: RideOption) => void;
		onRequestRide: () => void;
	} = $props();

	function optionClass(option: BookingOptionView): string {
		if (option.isSelected) return 'selected-option';
		if (isAdaptive && option.isRecommended) return 'recommended-option';
		return '';
	}

	let destinationContext = $derived(
		(recommendedDestination ?? 'Mobility Lab').replace(/\s*Drop-off$/i, '')
	);

	// Auto-select the recommended option for Adaptive mode (AIC).
	// Do not auto-select for SIC (isAdaptive === false).
	$effect(() => {
		if (!(isAdaptive && !hasSelection)) return;
		const recommended = options?.find((o) => o.isRecommended);
		if (recommended && recommended.option && recommended.option.id !== selectedOption?.id) {
			onAutoSelectOption(recommended.option);
		}
	});
</script>

<div
	class="booking-options-shell mt-3 grid gap-6 pb-28"
	class:aic-mode={isAdaptive}
	data-log-surface="booking_screen"
>
	<section class:aic-entrance={isAdaptive} data-log-surface="booking_summary">
		<h1 class="mt-2 text-3xl leading-tight font-bold text-forest">Choose your shuttle</h1>

		<section
			class="booking-schedule mt-5 border-y border-(--hairline) py-4"
			data-log-target="booking_schedule"
			data-log-type="summary_card"
		>
			<div class="booking-schedule-header flex items-start justify-between gap-4">
				<div>
					<p class="text-xs font-bold tracking-[0.16em] text-corduroy uppercase">Today</p>
					<h2 class="mt-1 text-xl leading-tight font-bold text-forest">Lab meeting</h2>
					<p class="mt-1 text-sm font-semibold text-corduroy">{destinationContext}</p>
				</div>
				<div class="booking-schedule-time text-right">
					<p class="text-xs font-bold text-corduroy">Starts</p>
					<p class="mt-1 text-xl font-bold text-forest">14:30</p>
				</div>
			</div>
			<div
				class="booking-schedule-badges mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-[#263C34]"
			>
				<span class="inline-flex items-center gap-1.5">
					<VerdeIcon name="clock" size={15} />Arrive by 14:25
				</span>
				<span class="inline-flex items-center gap-1.5">
					<VerdeIcon name="navigation" size={15} />Mobility Lab
				</span>
			</div>
		</section>

		<div
			class="booking-route-summary mt-4 grid grid-cols-[1fr_auto_1fr] items-start gap-3 text-sm font-bold"
			data-log-target="booking_route_summary"
			data-log-type="summary_card"
		>
			<div>
				<p class="text-[0.68rem] tracking-[0.14em] text-corduroy uppercase">From</p>
				<p class="mt-1 text-forest">Current Location</p>
			</div>
			<div class="booking-route-arrow mt-5 text-corduroy">&#10132</div>
			<div class="text-right">
				<p class="text-[0.68rem] tracking-[0.14em] text-corduroy uppercase">To</p>
				<p class="mt-1 text-forest">{recommendedDestination}</p>
			</div>
		</div>
		<div class="booking-route-map mt-4" data-log-surface="booking_route_map">
			<RouteMap
				{...routeMapProps}
				compact
				viewportMode={routeMapProps.map?.initialViewport ?? 'default'}
				interactive
				interactionSource={isAdaptive ? 'booking_inline' : 'booking_static_map'}
				{viewState}
				onViewStateChange={onViewStateChange}
				onMapInteraction={onMapInteraction}
				onMapTap={onOpenMap}
			/>
		</div>

		<div
			class="booking-route-caption mt-2"
			data-log-target="booking_route_caption"
			data-log-type="caption"
		>
			<p class="text-xs font-medium text-corduroy">Route to {destinationContext}</p>
			{#if isAdaptive}
				<p class="text-sm font-semibold text-forest">
					via {selectedOption?.label ?? 'your selected shuttle'}
				</p>
			{:else}
				<p class="text-xs font-medium text-corduroy">current campus route</p>
			{/if}
		</div>
	</section>

	<section class="booking-options-list grid gap-3" data-log-surface="booking_options_list">
		<div class="flex items-end justify-between gap-3">
			<div>
				<h2 class="text-xl leading-tight font-bold text-forest">Shuttle options</h2>
			</div>
			<p class="text-right text-xs font-semibold text-corduroy">{options.length} options</p>
		</div>

		{#each options as optionView (optionView.option.id)}
			{@const option = optionView.option}
			<button
				data-variant={option.id}
				data-log-target="ride_option"
				data-log-type="ride_option"
				class="verde-focus option-row grid w-full gap-3 rounded-[20px] border px-4 py-4 text-left transition active:scale-[0.99] {optionClass(
					optionView
				)}"
				class:aic-entrance={isAdaptive && optionView.isRecommended}
				class:opacity-50={hasRequestedRide && !optionView.isSelected}
				disabled={hasRequestedRide}
				onclick={() => onSelectOption(option)}
			>
				<div class="flex items-start justify-between gap-3">
					<div>
						<div class="flex flex-wrap items-center gap-2">
							<h3
								class="font-bold text-forest"
								class:text-3xl={isAdaptive && optionView.isRecommended}
								class:text-lg={!isAdaptive || !optionView.isRecommended}
							>
								{option.label}
							</h3>
							{#if isAdaptive && optionView.isRecommended}
								<span class="rounded-full bg-forest px-3 py-1.5 text-[0.7rem] font-bold text-white"
									>Suggested</span
								>
							{/if}
							{#if optionView.isSelected}
								<span class="rounded-full bg-leaf px-2.5 py-1 text-[0.68rem] font-bold text-white"
									>Selected</span
								>
							{/if}
						</div>
						<p
							class="mt-1 font-semibold text-corduroy"
							class:text-sm={!isAdaptive || optionView.isRecommended}
							class:text-xs={isAdaptive && !optionView.isRecommended}
						>
							{option.pickupPoint}
						</p>
					</div>
					<div class="text-right">
						<div class="flex items-center justify-end gap-0.5">
							<VerdeIcon name="clock" size={24} />
							<p
								class="font-bold text-forest"
								class:text-3xl={isAdaptive && optionView.isRecommended}
								class:text-2xl={!isAdaptive || !optionView.isRecommended}
							>
								{optionView.waitMinutes}
							</p>
						</div>
						<p class="text-[0.68rem] font-bold text-corduroy">min wait</p>
					</div>
				</div>
				<div class="grid grid-cols-3 gap-2 text-sm font-bold text-[#263C34]">
					<span class="option-metric walk inline-flex items-center gap-1.5">
						<VerdeIcon name="walk" size={15} />{option.walkMinutes} min walk
					</span>
					<span class="option-metric ride inline-flex items-center gap-1.5">
						<VerdeIcon name="route" size={15} />{option.rideMinutes} min ride
					</span>
					<span class="option-metric inline-flex items-center gap-1.5 text-[#36816C]">
						<VerdeIcon name="leaf" size={15} />{option.co2SavedKg.toFixed(1)} kg CO₂
					</span>
				</div>
				{#if isAdaptive && optionView.isRecommended}
					<p class="text-sm leading-5 text-[#263C34]">{option.recommendationReason}</p>
				{:else if isAdaptive && optionView.isSelected}
					<p class="text-sm leading-5 font-semibold text-forest">{optionView.comparisonReason}</p>
				{:else}
					<p class="text-sm leading-5 text-corduroy">{option.routeSummary}</p>
				{/if}
			</button>
		{/each}
	</section>

	<section
		class="booking-cta fixed inset-x-0 bottom-0 z-20 mx-auto max-w-107.5 border-t border-(--hairline) bg-white/95 px-5 pt-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] backdrop-blur-xl"
		data-log-surface="booking_cta"
	>
		<div class="grid gap-3">
			<p class="text-sm font-bold text-forest">
				{selectedOption?.label ?? 'Select a shuttle option'}
			</p>
			<p class="mt-1 text-xs font-semibold text-corduroy">
				{selectedOption
					? `${selectedOption.pickupPoint} · Arrival around ${
							options.find((item) => item.option.id === selectedOption.id)?.arrivalTime ?? ''
						}`
					: 'Choose one shuttle to continue'}
			</p>
			<button
				class="verde-focus rounded-full bg-forest px-4 py-3 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-40"
				disabled={!hasSelection}
				data-log-target="request_ride"
				data-log-type="primary_cta"
				onclick={onRequestRide}
			>
				Request ride
			</button>
		</div>
	</section>
</div>

<style>
	.booking-options-shell {
		min-width: 0;
	}

	.option-row {
		border-color: var(--hairline);
		background: rgba(255, 255, 255, 0.62);
	}

	.option-row:disabled {
		cursor: default;
	}

	.option-metric {
		min-width: 0;
		border-radius: 999px;
		background: #f6faf8;
		padding: 0.5rem 0.65rem;
		font-size: 0.78rem;
		line-height: 1.1;
	}

	.booking-schedule-header,
	.booking-route-summary,
	.booking-schedule-badges,
	.booking-route-caption,
	.booking-options-list,
	.booking-cta {
		min-width: 0;
	}

	.booking-route-map {
		display: block;
	}

	@media (max-width: 390px) {
		.booking-schedule {
			padding-block: 0.9rem;
		}

		.booking-schedule-header {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.75rem;
		}

		.booking-schedule-time {
			text-align: right;
		}

		.booking-schedule-badges {
			gap: 0.5rem 0.75rem;
			font-size: 0.875rem;
		}

		.booking-route-summary {
			gap: 0.5rem;
		}

		.booking-route-arrow {
			margin-top: 1.25rem;
		}

		.booking-options-list {
			gap: 0.75rem;
		}

		.booking-cta {
			padding-inline: 1rem;
		}
	}

	.recommended-option,
	.selected-option {
		position: relative;
		border-color: rgba(54, 129, 108, 0.46);
	}

	.selected-option::before {
		content: '';
		position: absolute;
		inset: 0.85rem auto 0.85rem 0.6rem;
		width: 5px;
		border-radius: 999px;
		background: #36816c;
	}

	.recommended-option::before {
		content: '';
		position: absolute;
		inset: 1.2rem auto 1.2rem 0.6rem;
		width: 3px;
		border-radius: 999px;
		background: #36816c;
	}

	.selected-option {
		background: #f6faf8;
		padding-left: 1.35rem;
	}

	.recommended-option {
		padding-left: 1.35rem;
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

	/* Variant colors for walk/ride labels
   Colors chosen to align with DESIGN.md tokens:
   - leaf (green): #36816C
   - status-attention (orange): #B8893A
   - status-critical (dark orange / reddish): #A74D3F
*/
	/* Apply variant label colors only in Adaptive (AIC) mode */
	.aic-mode button[data-variant='verde-direct'] .walk {
		color: #36816c; /* green */
	}
	.aic-mode button[data-variant='verde-direct'] .ride {
		color: #b8893a; /* orange */
	}

	.aic-mode button[data-variant='verde-sheltered'] .walk {
		color: #b8893a; /* orange */
	}
	.aic-mode button[data-variant='verde-sheltered'] .ride {
		color: #36816c; /* green */
	}

	.aic-mode button[data-variant='verde-shared'] .walk,
	.aic-mode button[data-variant='verde-shared'] .ride {
		color: #a74d3f; /* dark orange / reddish */
	}
</style>
