<script lang="ts">
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { StudyPhase } from '$lib/types';
	import DetailButton from './DetailButton.svelte';
	import type { DetailTopic } from './rideTypes';

	let {
		phase,
		isAdaptive,
		destination,
		routeSummary,
		originalEtaMinutes,
		revisedEtaMinutes,
		walkMinutes,
		rideMinutes,
		arrivalEstimate,
		detailRowClass,
		detailActionClass,
		onOpenDetail
	}: {
		phase: StudyPhase;
		isAdaptive: boolean;
		destination?: string;
		routeSummary?: string;
		originalEtaMinutes: number;
		revisedEtaMinutes: number;
		walkMinutes?: number;
		rideMinutes?: number;
		arrivalEstimate: string;
		detailRowClass: (kind?: 'default' | 'delay') => string;
		detailActionClass: (topic: DetailTopic) => string;
		onOpenDetail: (topic: DetailTopic, source: string) => void;
	} = $props();
</script>

<section
	class="rounded-[28px] border bg-white p-4"
	class:border-leaf={isAdaptive}
	class:border-(--hairline)={!isAdaptive}
	data-log-surface="ride_details_card"
	data-log-target="ride_details_card"
	data-log-type="details_card"
>
	<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">Ride details</p>
	<div class="mt-3 grid gap-2 text-sm font-semibold text-[#263C34]">
		<div
			class="flex items-center gap-2 rounded-2xl px-3 py-2 {detailRowClass()}"
			data-log-target="ride_detail_destination"
			data-log-type="detail_row"
		>
			<VerdeIcon name="map" size={16} />
			<p>Destination: {destination}</p>
		</div>
		<div
			class="flex items-center gap-2 rounded-2xl px-3 py-2 {detailRowClass()}"
			data-log-target="ride_detail_route"
			data-log-type="detail_row"
		>
			<VerdeIcon name="route" size={16} />
			<p>Route: {routeSummary}</p>
		</div>
		<div
			class="flex items-center gap-2 rounded-2xl px-3 py-2 {detailRowClass()}"
			data-log-target="ride_detail_eta"
			data-log-type="detail_row"
		>
			<VerdeIcon name="clock" size={16} />
			<p>{phase === 'delay' ? 'Expected remaining' : 'Original ETA'}: {originalEtaMinutes} min</p>
		</div>
		{#if phase === 'delay'}
			<div
				class="flex items-center gap-2 rounded-2xl px-3 py-2 {detailRowClass('delay')}"
				data-log-target="ride_detail_revised_eta"
				data-log-type="detail_row"
			>
				<VerdeIcon name="alert" size={16} />
				<p>Revised ETA: {revisedEtaMinutes} min</p>
			</div>
		{/if}
		<div
			class="flex items-center gap-2 rounded-2xl px-3 py-2 {detailRowClass()}"
			data-log-target="ride_detail_duration"
			data-log-type="detail_row"
		>
			<VerdeIcon name="walk" size={16} />
			<p>Walk: {walkMinutes} min · Ride: {rideMinutes} min</p>
		</div>
		<div
			class="flex items-center gap-2 rounded-2xl px-3 py-2 {detailRowClass()}"
			data-log-target="ride_detail_arrival"
			data-log-type="detail_row"
		>
			<VerdeIcon name="vehicle" size={16} />
			<p>Arrival estimate: around {arrivalEstimate}</p>
		</div>
	</div>
	<div class="mt-4 grid grid-cols-2 gap-2">
		<DetailButton
			topic="route"
			label="Route"
			icon="route"
			source={`${phase}_details`}
			className={detailActionClass('route')}
			onOpen={onOpenDetail}
		/>
		<DetailButton
			topic="sustainability"
			label="CO₂ impact"
			icon="leaf"
			source={`${phase}_details`}
			className={`${detailActionClass('sustainability')} col-span-2`}
			onOpen={onOpenDetail}
		/>
	</div>
</section>
