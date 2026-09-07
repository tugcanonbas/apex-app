<script lang="ts">
	import RouteMap from '$lib/components/RouteMap.svelte';
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { RouteMapInteractionPayload, RouteMapViewState } from '$lib/types';
	import type { DetailContent, DetailTopic, RouteMapViewProps } from './rideTypes';

	let {
		topic,
		detail,
		isAdaptive,
		routeMapProps,
		onClose,
		onScroll,
		onOpenMapFromDetail,
		onMapInteraction = () => undefined,
		viewState = null,
		onViewStateChange = () => undefined
	}: {
		topic: DetailTopic;
		detail: DetailContent;
		isAdaptive: boolean;
		routeMapProps: RouteMapViewProps;
		onClose: (method?: 'button' | 'backdrop' | 'replaced' | 'map_opened') => void;
		onScroll: (event: Event) => void;
		onOpenMapFromDetail: (source: string) => void;
		onMapInteraction?: (payload: RouteMapInteractionPayload) => void;
		viewState?: RouteMapViewState | null;
		onViewStateChange?: (state: RouteMapViewState) => void;
	} = $props();
</script>

<div
	class="fixed inset-0 z-40 flex items-end bg-forest/28 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm"
	role="button"
	tabindex="0"
	aria-label="Close detail sheet"
	data-log-target="detail_sheet_backdrop"
	data-log-type="modal_backdrop"
	data-log-surface="detail_sheet"
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
		class="mx-auto max-h-[88dvh] w-full max-w-107.5 overflow-y-auto rounded-[32px] border bg-white shadow-[0_-18px_50px_rgba(20,66,46,0.22)]"
		class:border-leaf={isAdaptive}
		class:border-(--hairline)={!isAdaptive}
		class:aic-detail-sheet={isAdaptive}
		onscroll={onScroll}
		data-log-target="detail_sheet"
		data-log-type={topic}
		data-log-surface="detail_sheet"
	>
		<div
			class="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-(--hairline) bg-white/95 px-5 pt-5 pb-4 backdrop-blur-xl"
		>
			<div>
				<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">
					{detail.eyebrow}
				</p>
				<h2 class="mt-2 text-2xl leading-tight font-bold text-forest">{detail.title}</h2>
			</div>
			<button
				class="verde-focus shrink-0 rounded-full border border-(--hairline) bg-canvas-mist px-4 py-2 text-xs font-bold text-forest"
				data-log-target="detail_sheet_close"
				data-log-type="modal_close"
				onclick={() => onClose('button')}
			>
				Close
			</button>
		</div>

		<div class="grid gap-4 p-5">
			<div
				class="rounded-[28px] border p-4"
				class:border-leaf={isAdaptive}
				class:bg-mint={isAdaptive}
				class:border-(--hairline)={!isAdaptive}
				class:bg-canvas-mist={!isAdaptive}
				data-log-target="detail_summary"
				data-log-type={topic}
			>
				<p class="text-sm leading-6 font-semibold text-[#263C34]">{detail.body}</p>
				{#if detail.primary}
					<p
						class="mt-3 rounded-2xl px-3 py-2 font-bold"
						class:bg-forest={isAdaptive}
						class:text-white={isAdaptive}
						class:bg-white={!isAdaptive}
						class:text-forest={!isAdaptive}
						class:text-xl={isAdaptive}
						class:text-base={!isAdaptive}
					>
						{detail.primary}
					</p>
				{/if}
			</div>

			<div class="grid gap-2">
				{#each detail.items as item (item.label)}
					{#if (item.label && item.label.toLowerCase().includes('co')) || item.icon === 'leaf'}
						<!-- Sustainability block: full width, prominent and styled per adaptive condition -->
						<article
							class="rounded-[24px] border p-3"
							class:border-leaf={isAdaptive}
							class:bg-[#F8FCFA]={isAdaptive}
							class:border-(--hairline)={!isAdaptive}
							class:bg-white={!isAdaptive}
							data-log-target={`detail_item:${item.label}`}
							data-log-type="detail_item"
						>
							<p class="text-[0.68rem] font-bold tracking-[0.14em] text-corduroy uppercase">CO₂</p>
							<div class="mt-2 flex items-center justify-between gap-3">
								<p class="text-2xl font-bold text-forest">
									{item.value}
								</p>
								{#if item.body}
									<p class="text-sm leading-5 text-corduroy">{item.body}</p>
								{/if}
							</div>
						</article>
					{:else}
						<article
							class="grid grid-cols-[auto_1fr] gap-3 rounded-[24px] border p-3"
							class:border-leaf={isAdaptive}
							class:bg-[#F8FCFA]={isAdaptive}
							class:border-(--hairline)={!isAdaptive}
							class:bg-white={!isAdaptive}
							data-log-target={`detail_item:${item.label}`}
							data-log-type="detail_item"
						>
							<div
								class="grid h-10 w-10 place-items-center rounded-2xl"
								class:bg-forest={isAdaptive}
								class:text-white={isAdaptive}
								class:bg-canvas-mist={!isAdaptive}
								class:text-forest={!isAdaptive}
							>
								<VerdeIcon name={item.icon} size={18} />
							</div>
							<div>
								<p class="text-[0.68rem] font-bold tracking-[0.14em] text-corduroy uppercase">
									{item.label}
								</p>
								<p class="mt-1 text-sm leading-5 font-bold text-forest">{item.value}</p>
								{#if item.body}
									<p class="mt-1 text-xs leading-5 text-corduroy">{item.body}</p>
								{/if}
							</div>
						</article>
					{/if}
				{/each}
			</div>

			<div class="grid gap-3">
				{#each detail.sections ?? [] as section (section.title)}
					<section
						class="rounded-[26px] border p-4"
						class:border-leaf={isAdaptive}
						class:bg-white={isAdaptive}
						class:border-[var(--hairline)]={!isAdaptive}
						class:bg-canvas-mist={!isAdaptive}
						data-log-target={`detail_section:${section.title}`}
						data-log-type="detail_section"
					>
						<h3 class="text-base font-bold text-forest">{section.title}</h3>
						<p class="mt-2 text-sm leading-6 text-corduroy">{section.body}</p>
						<ul class="mt-3 grid gap-2">
							{#each section.items as item (item)}
								<li class="flex items-start gap-2 text-sm leading-5 font-semibold text-[#263C34]">
									<span
										class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
										class:bg-forest={isAdaptive}
										class:bg-corduroy={!isAdaptive}
									></span>
									<span>{item}</span>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>

			{#if topic === 'route'}
				<RouteMap
					{...routeMapProps}
					compact
					viewportMode={routeMapProps.map?.initialViewport ?? 'default'}
					interactive
					interactionSource="detail_route"
					{viewState}
					onViewStateChange={onViewStateChange}
					onMapInteraction={onMapInteraction}
					onMapTap={onOpenMapFromDetail}
				/>
			{/if}

			{#if isAdaptive}
				<p
					class="rounded-[22px] border border-leaf/35 bg-white px-4 py-3 text-xs leading-5 font-semibold text-forest"
				>
					Key ride cues stay highlighted.
				</p>
			{:else}
				<p
					class="rounded-[22px] border border-(--hairline) bg-canvas-mist px-4 py-3 text-xs leading-5 font-semibold text-corduroy"
				>
					Ride information stays in the same layout.
				</p>
			{/if}
		</div>
	</section>
</div>

<style>
	.aic-detail-sheet {
		box-shadow:
			0 -3px 0 rgba(54, 129, 108, 0.72),
			0 -24px 60px rgba(20, 66, 46, 0.28);
	}
</style>
