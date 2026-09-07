<script lang="ts">
	import RouteMap from '$lib/components/RouteMap.svelte';
	import type { RouteMapInteractionPayload, RouteMapViewState, StudyPhase } from '$lib/types';
	import type { RouteMapViewProps } from './rideTypes';

	let {
		phase,
		isAdaptive,
		routeMapProps,
		onOpenMap,
		onMapInteraction = () => undefined,
		viewState = null,
		onViewStateChange = () => undefined
	}: {
		phase: StudyPhase;
		isAdaptive: boolean;
		routeMapProps: RouteMapViewProps;
		onOpenMap: (source: string) => void;
		onMapInteraction?: (payload: RouteMapInteractionPayload) => void;
		viewState?: RouteMapViewState | null;
		onViewStateChange?: (state: RouteMapViewState) => void;
	} = $props();
</script>

<RouteMap
	{...routeMapProps}
	compact={!isAdaptive || !['delay', 'near_arrival'].includes(phase)}
	viewportMode={routeMapProps.map?.initialViewport ?? 'default'}
	interactive
	interactionSource={`${phase}_map`}
	{viewState}
	onViewStateChange={onViewStateChange}
	onMapInteraction={onMapInteraction}
	onMapTap={onOpenMap}
/>
