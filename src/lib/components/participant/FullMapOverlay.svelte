<script lang="ts">
	import RouteMap from '$lib/components/RouteMap.svelte';
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { RouteMapInteractionPayload, RouteMapViewState } from '$lib/types';
	import type { RouteGuideContent, RouteMapViewProps } from './rideTypes';

	let {
		title,
		routeMapProps,
		routeGuide,
		onClose,
		onMapInteraction = () => undefined,
		viewState = null,
		onViewStateChange = () => undefined
	}: {
		title: string;
		routeMapProps: RouteMapViewProps;
		routeGuide?: RouteGuideContent | null;
		onClose: (method?: 'button' | 'detail_opened') => void;
		onMapInteraction?: (payload: RouteMapInteractionPayload) => void;
		viewState?: RouteMapViewState | null;
		onViewStateChange?: (state: RouteMapViewState) => void;
	} = $props();

	let hasRouteGuide = $derived(Boolean(routeGuide && routeGuide.items.length > 0));
</script>

<div
	class="fixed inset-0 z-50 flex items-end bg-forest/28 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm"
	role="button"
	tabindex="0"
	aria-label="Close route map"
	data-log-target="full_map_backdrop"
	data-log-type="modal_backdrop"
	data-log-surface="full_map_overlay"
	onclick={(event) => {
		if (event.target === event.currentTarget) onClose('button');
	}}
	onkeydown={(event) => {
		if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === 'Escape')) {
			onClose('button');
		}
	}}
>
	<section
		class="mx-auto flex max-h-[92dvh] w-full max-w-[430px] flex-col overflow-hidden rounded-[28px] border bg-white p-5 shadow-[0_-18px_50px_rgba(20,66,46,0.22)]"
		class:border-leaf={routeMapProps.adaptive}
		class:border-[var(--hairline)]={!routeMapProps.adaptive}
		role="dialog"
		aria-modal="true"
		data-log-target="full_map_sheet"
		data-log-type="modal_sheet"
		data-log-surface="full_map_overlay"
	>
		<header class="flex shrink-0 items-start justify-between gap-3">
			<div class="min-w-0">
				<p class="text-xs font-bold tracking-[0.16em] text-corduroy uppercase">Route map</p>
				<h2 class="mt-2 truncate text-2xl font-bold text-forest">{title}</h2>
			</div>
			<button
				class="verde-focus rounded-full border border-[var(--hairline)] bg-canvas-mist px-4 py-2 text-xs font-bold text-forest"
				data-log-target="full_map_close"
				data-log-type="modal_close"
				onclick={() => onClose('button')}
			>
				Close
			</button>
		</header>

		<div class="mt-4 min-h-0 overflow-y-auto">
			<div class="overflow-hidden rounded-[22px]">
				<RouteMap
					{...routeMapProps}
					viewportMode="expanded"
					interactive
					interactionSource="full_map"
					{viewState}
					onViewStateChange={onViewStateChange}
					onMapInteraction={onMapInteraction}
				/>
			</div>

			{#if hasRouteGuide && routeGuide}
				<section
					class="mt-5 border-t border-[var(--hairline)] pt-4"
					data-log-surface="full_map_route_guide"
				>
					<div class="grid grid-cols-[auto_1fr] gap-3">
						<div
							class="grid h-9 w-9 place-items-center rounded-full"
							class:bg-mint={routeMapProps.adaptive}
							class:bg-canvas-mist={!routeMapProps.adaptive}
						>
							<VerdeIcon name={routeMapProps.adaptive ? 'navigation' : 'route'} size={18} />
						</div>
						<div class="min-w-0">
							<p class="text-[0.68rem] font-bold tracking-[0.14em] text-corduroy uppercase">
								Route guide
							</p>
							<h3 class="mt-1 text-lg leading-tight font-bold text-forest">{routeGuide.title}</h3>
							<p class="mt-2 text-sm leading-6 font-semibold text-corduroy">{routeGuide.body}</p>
						</div>
					</div>

					<div class="mt-4 grid gap-2">
						{#each routeGuide.items as item}
							<div
								class="grid grid-cols-[auto_1fr] items-start gap-3 rounded-[18px] bg-canvas-mist px-3 py-3 text-sm font-semibold text-forest"
								data-log-target="route_guide_item"
								data-log-type="route_guide_item"
							>
								<VerdeIcon name="check" size={15} />
								<span>{item}</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	</section>
</div>
