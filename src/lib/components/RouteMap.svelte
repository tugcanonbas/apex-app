<script lang="ts">
	import type {
		MapTriggerTag,
		RouteMapInteractionAction,
		RouteMapInteractionPayload,
		RouteMapViewState,
		StudyMap,
		StudyMapObject,
		StudyMapViewport,
		StudyMapViewportKey,
		StudyPhase
	} from '$lib/types';

	type Point = { x: number; y: number };
	type RouteSegment = { from: Point; to: Point };
	type PointerState = {
		pointerId: number;
		startX: number;
		startY: number;
		lastX: number;
		lastY: number;
		startedAt: number;
		moved: boolean;
	};

	let {
		map,
		phase = 'booking',
		adaptive = false,
		compact = false,
		showLabels = true,
		showAllPickups = true,
		selectedPickup = '',
		participantProgress,
		participantX,
		participantY,
		participantDirectionDegrees,
		shuttleProgress,
		activeTriggerTags = [],
		participantMode = false,
		motionEnabled = true,
		viewportMode = 'default',
		interactive = false,
		interactionSource = 'route_map',
		viewState,
		onViewStateChange = () => undefined,
		onMapInteraction = () => undefined,
		onMapTap
	}: {
		map: StudyMap | null;
		phase?: StudyPhase;
		adaptive?: boolean;
		compact?: boolean;
		showLabels?: boolean;
		showAllPickups?: boolean;
		selectedPickup?: string;
		participantProgress?: number;
		participantX?: number;
		participantY?: number;
		participantDirectionDegrees?: number;
		shuttleProgress?: number;
		activeTriggerTags?: MapTriggerTag[];
		participantMode?: boolean;
		motionEnabled?: boolean;
		viewportMode?: StudyMapViewportKey;
		interactive?: boolean;
		interactionSource?: string;
		viewState?: RouteMapViewState | null;
		onViewStateChange?: (state: RouteMapViewState) => void;
		onMapInteraction?: (payload: RouteMapInteractionPayload) => void;
		onMapTap?: (source: string) => void;
	} = $props();

	const shuttleProgressLimit = 1;
	const shuttleStopAfterArrivingZoneExitPx = 50;
	const minZoom = 1;
	const maxZoom = 4;
	const zoomStep = 0.35;

	let svgElement = $state<SVGSVGElement | null>(null);
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let pointerState = $state<PointerState | null>(null);
	let viewportSignature = $state('');
	let followedLocationSignature = $state('');

	let shuttleRouteStopProgress = $derived.by(() => {
		const shuttleObject = map?.objects.find((item) => item.type === 'shuttle');
		if (!shuttleObject) return shuttleProgressLimit;
		return progressAfterZoneExit(
			shuttleRoutePoints(shuttleObject),
			shuttleArrivingZone(),
			shuttleStopAfterArrivingZoneExitPx
		);
	});
	let scriptedShuttleProgress = $derived(
		phase === 'arrival'
			? shuttleProgressLimit
			: phase === 'near_arrival'
				? shuttleProgressLimit
				: phase === 'delay'
					? 0.56
					: phase === 'waiting'
						? 0.38
						: 0.18
	);
	let effectiveShuttleProgress = $derived(
		Math.min(
			shuttleRouteStopProgress,
			(typeof shuttleProgress === 'number'
				? Math.min(1, Math.max(0, shuttleProgress))
				: scriptedShuttleProgress) * shuttleRouteStopProgress
		)
	);
	let effectiveParticipantProgress = $derived(
		typeof participantProgress === 'number' ? Math.min(1, Math.max(0, participantProgress)) : 0
	);
	let adaptiveRouteSegments = $derived.by(() => {
		const currentObject = map?.objects.find((item) => item.type === 'current_location');
		if (!adaptive || !currentObject)
			return { completed: [] as RouteSegment[], remaining: [] as RouteSegment[] };
		return splitRouteByProgress(
			participantRoutePoints(currentObject),
			effectiveParticipantProgress
		);
	});
	let adaptiveShuttleRouteSegments = $derived.by(() => {
		const shuttleObject = map?.objects.find((item) => item.type === 'shuttle');
		if (!adaptive || !shuttleObject)
			return { completed: [] as RouteSegment[], remaining: [] as RouteSegment[] };
		return splitRouteByProgress(shuttleRoutePoints(shuttleObject), effectiveShuttleProgress);
	});
	let visibleObjects = $derived.by(() =>
		(map?.objects.filter(shouldShowObject) ?? []).sort(
			(left, right) =>
				objectRenderRank(left) - objectRenderRank(right) || left.id.localeCompare(right.id)
		)
	);
	let adaptiveForegroundMarkers = $derived.by(() =>
		visibleObjects.filter(
			(object) => object.type === 'pickup' || object.type === 'current_location'
		)
	);
	let currentLocationPoint = $derived.by((): Point | null => {
		const currentObject = map?.objects.find((item) => item.type === 'current_location');
		return currentObject ? pointForObject(currentObject) : null;
	});
	let baseViewport = $derived.by((): StudyMapViewport | null => {
		if (!map) return null;
		return map.viewports?.[viewportMode] ?? { x: 0, y: 0, width: map.width, height: map.height };
	});
	let visibleViewport = $derived.by((): StudyMapViewport | null => {
		if (!baseViewport) return null;
		return viewportForState(zoom, panX, panY);
	});
	let initialViewState = $derived.by(() => {
		if (!baseViewport) return { zoom: minZoom, panX: 0, panY: 0 };
		const initialView = map?.initialView;
		const initialViewportKey = initialView?.viewport ?? map?.initialViewport ?? 'default';
		const targetViewport = map?.viewports?.[initialViewportKey] ?? null;
		if (!targetViewport) return { zoom: minZoom, panX: 0, panY: 0 };

		const fitZoom = clamp(
			Math.min(
				baseViewport.width / targetViewport.width,
				baseViewport.height / targetViewport.height
			),
			minZoom,
			maxZoom
		);
		const configuredZoom = clamp(Number(initialView?.zoom ?? minZoom), minZoom, maxZoom);
		const nextZoom = clamp(fitZoom * configuredZoom, minZoom, maxZoom);

		return {
			zoom: Number(nextZoom.toFixed(2)),
			panX:
				targetViewport.x +
				targetViewport.width / 2 -
				(baseViewport.x + baseViewport.width / 2) +
				Number(initialView?.panX ?? 0),
			panY:
				targetViewport.y +
				targetViewport.height / 2 -
				(baseViewport.y + baseViewport.height / 2) +
				Number(initialView?.panY ?? 0)
		};
	});
	let externalViewState = $derived.by(() => {
		if (!baseViewport || !viewState?.visibleViewport || viewState.mapId !== map?.id) return null;
		const targetViewport = viewState.visibleViewport;
		const targetCenterX = targetViewport.x + targetViewport.width / 2;
		const targetCenterY = targetViewport.y + targetViewport.height / 2;
		const nextZoom = clamp(
			Math.min(baseViewport.width / targetViewport.width, baseViewport.height / targetViewport.height),
			minZoom,
			maxZoom
		);

		return {
			zoom: Number(nextZoom.toFixed(2)),
			panX: targetCenterX - (baseViewport.x + baseViewport.width / 2),
			panY: targetCenterY - (baseViewport.y + baseViewport.height / 2),
			updatedAt: viewState.updatedAt
		};
	});

	$effect(() => {
		const nextState = externalViewState ?? initialViewState;
		const signature = `${map?.id ?? 'none'}:${viewportMode}:${interactive}:${externalViewState?.updatedAt ?? 'initial'}:${nextState.zoom}:${nextState.panX}:${nextState.panY}`;
		if (signature === viewportSignature) return;
		viewportSignature = signature;
		zoom = nextState.zoom;
		panX = nextState.panX;
		panY = nextState.panY;
		pointerState = null;
	});

	$effect(() => {
		if (!map || !baseViewport || !currentLocationPoint || pointerState) return;
		const followContext = `${map.id}:${viewportMode}`;
		const signature = [
			followContext,
			currentLocationPoint.x.toFixed(2),
			currentLocationPoint.y.toFixed(2)
		].join(':');
		if (!followedLocationSignature || !followedLocationSignature.startsWith(followContext)) {
			followedLocationSignature = signature;
			return;
		}
		if (signature === followedLocationSignature) return;
		followedLocationSignature = signature;
		const centeredPan = centeredPanFor(currentLocationPoint, zoom);
		panX = centeredPan.panX;
		panY = centeredPan.panY;
		publishViewStateFor(zoom, centeredPan.panX, centeredPan.panY);
	});

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	function setZoom(nextZoom: number) {
		zoom = Number(clamp(nextZoom, minZoom, maxZoom).toFixed(2));
		if (zoom === minZoom) {
			panX = 0;
			panY = 0;
		}
	}

	function viewportForState(
		nextZoom: number,
		nextPanX: number,
		nextPanY: number
	): StudyMapViewport | null {
		if (!baseViewport) return null;
		const width = baseViewport.width / nextZoom;
		const height = baseViewport.height / nextZoom;
		const maxPanX = Math.max(0, (baseViewport.width - width) / 2);
		const maxPanY = Math.max(0, (baseViewport.height - height) / 2);
		const boundedPanX = clamp(nextPanX, -maxPanX, maxPanX);
		const boundedPanY = clamp(nextPanY, -maxPanY, maxPanY);

		return {
			...baseViewport,
			x: baseViewport.x + (baseViewport.width - width) / 2 + boundedPanX,
			y: baseViewport.y + (baseViewport.height - height) / 2 + boundedPanY,
			width,
			height
		};
	}

	function centeredPanFor(point: Point | null, nextZoom: number): { panX: number; panY: number } {
		if (!baseViewport || !point) {
			return { panX: initialViewState.panX, panY: initialViewState.panY };
		}
		const nextWidth = baseViewport.width / nextZoom;
		const nextHeight = baseViewport.height / nextZoom;
		const maxPanX = Math.max(0, (baseViewport.width - nextWidth) / 2);
		const maxPanY = Math.max(0, (baseViewport.height - nextHeight) / 2);

		return {
			panX: clamp(point.x - (baseViewport.x + baseViewport.width / 2), -maxPanX, maxPanX),
			panY: clamp(point.y - (baseViewport.y + baseViewport.height / 2), -maxPanY, maxPanY)
		};
	}

	function emitMapInteraction(
		action: RouteMapInteractionAction,
		extra: Partial<RouteMapInteractionPayload> = {}
	) {
		onMapInteraction({
			action,
			source: interactionSource,
			mapId: map?.id,
			mapName: map?.name,
			phase,
			initialViewport: map?.initialViewport ?? 'default',
			viewportMode,
			zoom,
			panX,
			panY,
			visibleViewport,
			...extra
		});
	}

	function publishViewState() {
		publishViewStateFor(zoom, panX, panY);
	}

	function publishViewStateFor(nextZoom: number, nextPanX: number, nextPanY: number) {
		onViewStateChange({
			mapId: map?.id,
			viewportMode,
			zoom: nextZoom,
			panX: nextPanX,
			panY: nextPanY,
			visibleViewport: viewportForState(nextZoom, nextPanX, nextPanY),
			updatedAt: Date.now()
		});
	}

	function handleResetView() {
		const previousZoom = zoom;
		const nextZoom = initialViewState.zoom;
		const centeredPan = centeredPanFor(currentLocationPoint, nextZoom);
		zoom = nextZoom;
		panX = centeredPan.panX;
		panY = centeredPan.panY;
		pointerState = null;
		publishViewStateFor(nextZoom, centeredPan.panX, centeredPan.panY);
		emitMapInteraction('reset', { previousZoom });
	}

	function handlePointerDown(event: PointerEvent) {
		if (!interactive || !svgElement) return;
		event.preventDefault();
		svgElement.setPointerCapture(event.pointerId);
		pointerState = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			lastX: event.clientX,
			lastY: event.clientY,
			startedAt: Date.now(),
			moved: false
		};
	}

	function handlePointerMove(event: PointerEvent) {
		if (!interactive || !pointerState || !svgElement || !visibleViewport) return;
		if (event.pointerId !== pointerState.pointerId) return;

		const bounds = svgElement.getBoundingClientRect();
		if (bounds.width <= 0 || bounds.height <= 0) return;

		const deltaX = event.clientX - pointerState.lastX;
		const deltaY = event.clientY - pointerState.lastY;
		const distancePx = Math.hypot(event.clientX - pointerState.startX, event.clientY - pointerState.startY);
		const moved = pointerState.moved || distancePx > 8;

		if (zoom > minZoom && moved) {
			panX -= (deltaX / bounds.width) * visibleViewport.width;
			panY -= (deltaY / bounds.height) * visibleViewport.height;
		}

		pointerState = {
			...pointerState,
			lastX: event.clientX,
			lastY: event.clientY,
			moved
		};
	}

	function handlePointerEnd(event: PointerEvent) {
		if (!svgElement || !pointerState || event.pointerId !== pointerState.pointerId) return;
		const endedState = pointerState;
		if (svgElement.hasPointerCapture(event.pointerId)) {
			svgElement.releasePointerCapture(event.pointerId);
		}
		pointerState = null;

		const distancePx = Math.hypot(event.clientX - endedState.startX, event.clientY - endedState.startY);
		const durationMs = Date.now() - endedState.startedAt;
		if (endedState.moved || distancePx > 8) {
			publishViewState();
			emitMapInteraction('pan', { durationMs, distancePx: Math.round(distancePx) });
			return;
		}

		emitMapInteraction('tap', { durationMs, distancePx: Math.round(distancePx) });
		onMapTap?.(interactionSource);
	}

	function handlePointerCancel(event: PointerEvent) {
		if (!svgElement || !pointerState || event.pointerId !== pointerState.pointerId) return;
		if (svgElement.hasPointerCapture(event.pointerId)) {
			svgElement.releasePointerCapture(event.pointerId);
		}
		pointerState = null;
	}

	function handleWheel(event: WheelEvent) {
		if (!interactive) return;
		event.preventDefault();
		const previousZoom = zoom;
		setZoom(zoom + (event.deltaY < 0 ? zoomStep : -zoomStep));
		publishViewState();
		emitMapInteraction('wheel_zoom', { previousZoom });
	}

	function handleZoomIn() {
		const previousZoom = zoom;
		setZoom(zoom + zoomStep);
		publishViewState();
		emitMapInteraction('zoom_in', { previousZoom });
	}

	function handleZoomOut() {
		const previousZoom = zoom;
		setZoom(zoom - zoomStep);
		publishViewState();
		emitMapInteraction('zoom_out', { previousZoom });
	}

	function objectRenderRank(object: StudyMapObject): number {
		if (typeof object.zIndex === 'number') return object.zIndex;
		if (object.type === 'obstacle' || object.type === 'zone') return 0;
		if (object.type === 'road') return 10;
		if (object.type === 'pedestrian_road') return 20;
		if (object.type === 'wall') return 30;
		if (object.type === 'shuttle_path') return 40;
		if (object.type === 'shuttle') return 50;
		if (object.type === 'path') return 70;
		if (object.type === 'participant_start' || object.type === 'label') return 80;
		if (object.type === 'pickup' || object.type === 'current_location') return 90;
		return 50;
	}

	function objectClass(type: StudyMapObject['type']): string {
		if (type === 'pickup') return 'fill-leaf stroke-forest';
		if (type === 'current_location') return 'fill-[#1f7aff] stroke-white';
		if (type === 'participant_start') return 'fill-mint stroke-forest';
		if (type === 'shuttle')
			return adaptive
				? `fill-forest stroke-leaf ${motionEnabled ? 'shuttle-pulse' : ''}`
				: 'fill-forest stroke-forest';
		if (type === 'obstacle') return 'fill-attention/20 stroke-attention';
		if (type === 'zone') return 'fill-mint/45 stroke-leaf/40';
		if (type === 'road') return 'stroke-[#D9E3DF]';
		if (type === 'pedestrian_road') return 'stroke-[#E8F4EF]';
		if (type === 'shuttle_path') return 'stroke-forest';
		return 'stroke-corduroy';
	}

	function selectedPickupObject(): StudyMapObject | undefined {
		const pickups = map?.objects.filter((item) => item.type === 'pickup') ?? [];
		if (!selectedPickup) return pickups[0];
		const selectedCode = pickupCode(selectedPickup);
		return pickups.find((item) => pickupCode(item.label) === selectedCode) ?? pickups[0];
	}

	function distance(from: Point, to: Point): number {
		return Math.hypot(to.x - from.x, to.y - from.y);
	}

	function pushPoint(points: Point[], point: Point) {
		const previous = points.at(-1);
		if (!previous || distance(previous, point) > 1) points.push(point);
	}

	function routePointsFor(
		pathType: 'path' | 'shuttle_path',
		startObject: StudyMapObject,
		targetObject: StudyMapObject | undefined
	): Point[] {
		const pathObjects = [...(map?.objects.filter((item) => item.type === pathType) ?? [])];
		const points: Point[] = [{ x: startObject.x, y: startObject.y }];

		if (pathObjects.length === 0) {
			if (targetObject) pushPoint(points, { x: targetObject.x, y: targetObject.y });
			return points;
		}

		let cursor: Point = { x: startObject.x, y: startObject.y };
		while (pathObjects.length > 0) {
			let bestIndex = 0;
			let bestReversed = false;
			let bestDistance = Number.POSITIVE_INFINITY;

			for (const [index, pathObject] of pathObjects.entries()) {
				const startDistance = distance(cursor, { x: pathObject.x, y: pathObject.y });
				const endDistance = distance(cursor, {
					x: pathObject.x2 ?? pathObject.x,
					y: pathObject.y2 ?? pathObject.y
				});
				if (startDistance < bestDistance) {
					bestDistance = startDistance;
					bestIndex = index;
					bestReversed = false;
				}
				if (endDistance < bestDistance) {
					bestDistance = endDistance;
					bestIndex = index;
					bestReversed = true;
				}
			}

			const [pathObject] = pathObjects.splice(bestIndex, 1);
			const routeStart = bestReversed
				? { x: pathObject.x2 ?? pathObject.x, y: pathObject.y2 ?? pathObject.y }
				: { x: pathObject.x, y: pathObject.y };
			const routeEnd = bestReversed
				? { x: pathObject.x, y: pathObject.y }
				: { x: pathObject.x2 ?? pathObject.x, y: pathObject.y2 ?? pathObject.y };

			pushPoint(points, routeStart);
			pushPoint(points, routeEnd);
			cursor = routeEnd;
		}

		if (targetObject) {
			const lastPoint = points.at(-1);
			const targetPoint = { x: targetObject.x, y: targetObject.y };
			if (lastPoint && distance(lastPoint, targetPoint) < 60) {
				pushPoint(points, targetPoint);
			}
		}
		return points;
	}

	function participantRoutePoints(currentObject: StudyMapObject): Point[] {
		const start = map?.objects.find((item) => item.type === 'participant_start') ?? currentObject;
		return routePointsFor('path', start, selectedPickupObject());
	}

	function shuttleRoutePoints(shuttleObject: StudyMapObject): Point[] {
		return routePointsFor('shuttle_path', shuttleObject, selectedPickupObject());
	}

	function pointAlongRoute(points: Point[], progress: number): Point {
		if (points.length <= 1) return points[0] ?? { x: 0, y: 0 };
		const segments = points.slice(0, -1).map((point, index) => ({
			from: point,
			to: points[index + 1],
			length: distance(point, points[index + 1])
		}));
		const totalLength = segments.reduce((total, segment) => total + segment.length, 0);
		if (totalLength <= 0) return points.at(-1) ?? points[0];

		let remaining = totalLength * Math.min(1, Math.max(0, progress));
		for (const segment of segments) {
			if (remaining <= segment.length) {
				const localProgress = segment.length === 0 ? 0 : remaining / segment.length;
				return {
					x: segment.from.x + (segment.to.x - segment.from.x) * localProgress,
					y: segment.from.y + (segment.to.y - segment.from.y) * localProgress
				};
			}
			remaining -= segment.length;
		}

		return points.at(-1) ?? points[0];
	}

	function routeTotalLength(points: Point[]): number {
		return points
			.slice(0, -1)
			.reduce((total, point, index) => total + distance(point, points[index + 1]), 0);
	}

	function containsPoint(zone: StudyMapObject, point: Point): boolean {
		const width = zone.width ?? 80;
		const height = zone.height ?? 48;
		return (
			point.x >= zone.x &&
			point.x <= zone.x + width &&
			point.y >= zone.y &&
			point.y <= zone.y + height
		);
	}

	function progressAfterZoneExit(
		points: Point[],
		zone: StudyMapObject | undefined,
		distanceAfterExit: number
	): number {
		if (!zone || points.length <= 1) return shuttleProgressLimit;
		const totalLength = routeTotalLength(points);
		if (totalLength <= 0) return shuttleProgressLimit;

		let traveled = 0;
		let lastInsideDistance: number | null = null;

		for (const [index, from] of points.slice(0, -1).entries()) {
			const to = points[index + 1];
			const segmentLength = distance(from, to);
			const steps = Math.max(1, Math.ceil(segmentLength));

			for (let step = 0; step <= steps; step += 1) {
				const localDistance = Math.min(segmentLength, step);
				const localProgress = segmentLength === 0 ? 0 : localDistance / segmentLength;
				const point = {
					x: from.x + (to.x - from.x) * localProgress,
					y: from.y + (to.y - from.y) * localProgress
				};
				if (containsPoint(zone, point)) lastInsideDistance = traveled + localDistance;
			}

			traveled += segmentLength;
		}

		if (lastInsideDistance === null) return shuttleProgressLimit;
		return Math.min(shuttleProgressLimit, (lastInsideDistance + distanceAfterExit) / totalLength);
	}

	function shuttleArrivingZone(): StudyMapObject | undefined {
		return map?.objects.find((object) => {
			if (object.type !== 'zone') return false;
			if (object.triggerTags?.includes('shuttle_arriving_zone_enter')) return true;
			const label = object.label
				.trim()
				.toLowerCase()
				.replace(/[\s_]+/g, '-');
			return label.includes('shuttle-arriving') || label.includes('shuttle-approach');
		});
	}

	function splitRouteByProgress(
		points: Point[],
		progress: number
	): { completed: RouteSegment[]; remaining: RouteSegment[] } {
		const completed: RouteSegment[] = [];
		const remaining: RouteSegment[] = [];
		if (points.length <= 1) return { completed, remaining };

		const segments = points.slice(0, -1).map((point, index) => ({
			from: point,
			to: points[index + 1],
			length: distance(point, points[index + 1])
		}));
		const totalLength = segments.reduce((total, segment) => total + segment.length, 0);
		if (totalLength <= 0) return { completed, remaining };

		let covered = totalLength * Math.min(1, Math.max(0, progress));
		for (const segment of segments) {
			if (segment.length <= 0) continue;
			if (covered >= segment.length) {
				completed.push({ from: segment.from, to: segment.to });
				covered -= segment.length;
				continue;
			}

			if (covered > 0) {
				const localProgress = covered / segment.length;
				const currentPoint = {
					x: segment.from.x + (segment.to.x - segment.from.x) * localProgress,
					y: segment.from.y + (segment.to.y - segment.from.y) * localProgress
				};
				completed.push({ from: segment.from, to: currentPoint });
				remaining.push({ from: currentPoint, to: segment.to });
			} else {
				remaining.push({ from: segment.from, to: segment.to });
			}
			covered = 0;
		}

		return { completed, remaining };
	}

	function interpolate(
		from: StudyMapObject,
		to: StudyMapObject | undefined,
		progress: number
	): { x: number; y: number } {
		if (!to) return { x: from.x, y: from.y };
		return {
			x: from.x + (to.x - from.x) * progress,
			y: from.y + (to.y - from.y) * progress
		};
	}

	function pointForObject(object: StudyMapObject): { x: number; y: number } {
		const pickup = selectedPickupObject();
		if (object.type === 'shuttle') {
			return interpolate(object, pickup, effectiveShuttleProgress);
		}
		if (object.type === 'current_location') {
			if (typeof participantX === 'number' && typeof participantY === 'number') {
				return { x: participantX, y: participantY };
			}
			return pointAlongRoute(participantRoutePoints(object), effectiveParticipantProgress);
		}
		return { x: object.x, y: object.y };
	}

	function currentLocationDirectionDegrees(): number {
		if (typeof participantDirectionDegrees === 'number') {
			return ((participantDirectionDegrees % 360) + 360) % 360;
		}
		const currentObject = map?.objects.find((item) => item.type === 'current_location');
		if (!currentObject) return 0;
		const points = participantRoutePoints(currentObject);
		if (points.length <= 1) return 0;
		const progress = effectiveParticipantProgress;
		const index = Math.min(points.length - 2, Math.max(0, Math.floor(progress * (points.length - 1))));
		const from = points[index];
		const to = points[index + 1];
		return ((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI + 360) % 360;
	}

	function pointForShuttle(object: StudyMapObject): { x: number; y: number } {
		if (!adaptive && typeof shuttleProgress !== 'number') return { x: object.x, y: object.y };
		return pointAlongRoute(shuttleRoutePoints(object), effectiveShuttleProgress);
	}

	function pickupCode(value: string): string {
		return value.match(/pickup\s*(point\s*)?([a-z])/i)?.[2]?.toLowerCase() ?? '';
	}

	function shouldShowObject(object: StudyMapObject): boolean {
		if (!showLabels && object.type === 'label') return false;
		if (participantMode && object.type === 'participant_start') return false;
		if (object.type === 'zone' && participantMode) {
			if (object.triggerTags?.length) return false;
			if (object.participantVisible === false) return false;
		}
		if (object.showWhenTriggers?.length && !hasAnyTrigger(object.showWhenTriggers)) return false;
		if (object.hideWhenTriggers?.length && hasAnyTrigger(object.hideWhenTriggers)) return false;
		if (object.type !== 'pickup' || showAllPickups || !selectedPickup) return true;
		const objectCode = pickupCode(object.label);
		const selectedCode = pickupCode(selectedPickup);
		return Boolean(objectCode && selectedCode && objectCode === selectedCode);
	}

	function hasAnyTrigger(tags: MapTriggerTag[]): boolean {
		return tags.some((tag) => activeTriggerTags.includes(tag));
	}

	function triggerObjectLabel(object: StudyMapObject): string {
		return object.triggerTags?.length
			? `${object.label} · ${object.triggerTags.join(', ')}`
			: object.label;
	}
</script>

<div
	class="relative overflow-hidden rounded-verde-xl border border-[var(--hairline)] bg-[#F6FAF8]"
	class:motion-disabled={!motionEnabled}
	data-log-surface={interactionSource}
	data-log-target="route_map_frame"
	data-log-type="map_frame"
>
	{#if map}
		<svg
			bind:this={svgElement}
			viewBox={`${visibleViewport?.x ?? 0} ${visibleViewport?.y ?? 0} ${visibleViewport?.width ?? map.width} ${visibleViewport?.height ?? map.height}`}
			class={compact ? 'block h-56 w-full' : 'block h-72 w-full'}
			class:cursor-grab={interactive && zoom > minZoom && !pointerState}
			class:cursor-grabbing={interactive && Boolean(pointerState)}
			class:touch-none={interactive}
			role="img"
			aria-label={map.name}
			data-log-target="route_map_canvas"
			data-log-type="map_canvas"
			data-log-surface={interactionSource}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerEnd}
			onpointercancel={handlePointerCancel}
			onwheel={handleWheel}
			ondblclick={handleZoomIn}
		>
			<rect
				x={visibleViewport?.x ?? 0}
				y={visibleViewport?.y ?? 0}
				width={visibleViewport?.width ?? map.width}
				height={visibleViewport?.height ?? map.height}
				fill="#F6FAF8"
			/>
			{#each visibleObjects as object (object.id)}
				{#if object.type === 'zone'}
					<rect
						x={object.x}
						y={object.y}
						width={object.width ?? 80}
						height={object.height ?? 48}
						rx="20"
						class={objectClass(object.type)}
						stroke-width="1.5"
						data-log-target={`map_object:${object.type}:${object.id}`}
						data-log-type={object.type}
						data-log-surface={interactionSource}
					/>
				{:else if object.type === 'wall'}
					<line
						x1={object.x}
						y1={object.y}
						x2={object.x2 ?? object.x + 80}
						y2={object.y2 ?? object.y}
						class={objectClass(object.type)}
						stroke-width={object.size ?? 5}
						stroke-linecap="round"
						data-log-target={`map_object:${object.type}:${object.id}`}
						data-log-type={object.type}
						data-log-surface={interactionSource}
					/>
				{:else if object.type === 'road'}
					<line
						x1={object.x}
						y1={object.y}
						x2={object.x2 ?? object.x + 120}
						y2={object.y2 ?? object.y}
						stroke="#D9E3DF"
						stroke-width={object.size ?? 26}
						stroke-linecap="butt"
						opacity="0.82"
					/>
					<line
						x1={object.x}
						y1={object.y}
						x2={object.x2 ?? object.x + 120}
						y2={object.y2 ?? object.y}
						stroke="#FFFFFF"
						stroke-width="2.5"
						stroke-dasharray="14 12"
						stroke-linecap="butt"
						opacity="0.55"
					/>
				{:else if object.type === 'pedestrian_road'}
					<line
						x1={object.x}
						y1={object.y}
						x2={object.x2 ?? object.x + 120}
						y2={object.y2 ?? object.y}
						stroke="#E8F4EF"
						stroke-width={object.size ?? 18}
						stroke-linecap="butt"
						opacity="0.9"
					/>
					<line
						x1={object.x}
						y1={object.y}
						x2={object.x2 ?? object.x + 120}
						y2={object.y2 ?? object.y}
						stroke="#8BAEA0"
						stroke-width="1.5"
						stroke-dasharray="5 7"
						stroke-linecap="butt"
						opacity="0.42"
					/>
				{:else if object.type === 'path'}
					{#if !adaptive}
						<line
							x1={object.x}
							y1={object.y}
							x2={object.x2 ?? object.x + 80}
							y2={object.y2 ?? object.y}
							class="stroke-leaf"
							stroke-width={object.size ?? 6}
							stroke-linecap="round"
						/>
					{/if}
				{:else if object.type === 'shuttle_path'}
					{#if !adaptive}
						<line
							x1={object.x}
							y1={object.y}
							x2={object.x2 ?? object.x + 80}
							y2={object.y2 ?? object.y}
							class="stroke-forest"
							stroke-width={object.size ?? 7}
							stroke-linecap="round"
							stroke-dasharray="8 8"
							opacity="0.56"
						/>
					{/if}
				{:else if object.type === 'label'}
					<text
						x={object.x}
						y={object.y}
						fill="#14422E"
						font-size={object.size ?? 13}
						font-weight="700"
						data-log-target={`map_object:${object.type}:${object.id}`}
						data-log-type={object.type}
						data-log-surface={interactionSource}>{object.label}</text
					>
				{:else if object.type === 'obstacle'}
					<rect
						x={object.x}
						y={object.y}
						width={object.width ?? 44}
						height={object.height ?? 34}
						rx="12"
						class={objectClass(object.type)}
						stroke-width="1.5"
						data-log-target={`map_object:${object.type}:${object.id}`}
						data-log-type={object.type}
						data-log-surface={interactionSource}
					/>
					<text x={object.x + 8} y={object.y + 22} fill="#14422E" font-size="10"
						>{object.label}</text
					>
				{:else}
					{@const point =
						object.type === 'shuttle' ? pointForShuttle(object) : pointForObject(object)}
					<g
						class={motionEnabled &&
						((object.type === 'shuttle' && adaptive) || object.type === 'current_location')
							? 'route-motion'
							: ''}
						data-log-target={`map_object:${object.type}:${object.id}`}
						data-log-type={object.type}
						data-log-surface={interactionSource}
					>
						{#if object.type === 'shuttle'}
							<g transform={`translate(${point.x} ${point.y})`}>
								<rect
									x="-17"
									y="-10"
									width="34"
									height="20"
									rx="8"
									class={objectClass(object.type)}
									stroke-width="2"
								/>
								<rect
									x="-9"
									y="-15"
									width="18"
									height="10"
									rx="4"
									class="fill-mint stroke-forest"
									stroke-width="1.5"
								/>
								<circle cx="-9" cy="11" r="3" class="fill-corduroy" />
								<circle cx="9" cy="11" r="3" class="fill-corduroy" />
							</g>
						{:else if object.type === 'current_location'}
							<g transform={`translate(${point.x} ${point.y})`} class="current-location-marker">
								<circle r="24" class="current-location-glow" />
								<circle r="14" class="current-location-range" />
								<g transform={`rotate(${currentLocationDirectionDegrees()})`}>
									<path
										d="M0 -24 L8 -7 L0 -11 L-8 -7 Z"
										class="fill-forest stroke-white"
										stroke-width="2"
										stroke-linejoin="round"
									/>
								</g>
								<circle r="7" class={objectClass(object.type)} stroke-width="3" />
							</g>
						{:else if object.type === 'pickup' || object.type === 'participant_start'}
							<g transform={`translate(${point.x} ${point.y})`}>
								<path
									d="M0 -15 C8 -15 14 -9 14 -1 C14 8 3 17 0 20 C-3 17 -14 8 -14 -1 C-14 -9 -8 -15 0 -15 Z"
									class={objectClass(object.type)}
									stroke-width="2"
								/>
								<circle
									cx="0"
									cy="-2"
									r="5"
									class={object.type === 'pickup' ? 'fill-white' : 'fill-forest'}
								/>
							</g>
						{:else}
							<circle
								cx={point.x}
								cy={point.y}
								r={object.size ?? 11}
								class={objectClass(object.type)}
								stroke-width="2"
							/>
						{/if}
						{#if adaptive && motionEnabled && object.type === 'shuttle'}
							<circle
								cx={point.x}
								cy={point.y}
								r={(object.size ?? 15) + 8}
								class="shuttle-ring fill-transparent stroke-leaf"
								stroke-width="3"
							/>
						{/if}
						<text x={point.x + 18} y={point.y + 4} fill="#263C34" font-size="11" font-weight="600"
							>{triggerObjectLabel(object)}</text
						>
					</g>
				{/if}
			{/each}
			{#if adaptive}
				<g aria-hidden="true">
					{#each adaptiveRouteSegments.remaining as segment}
						<line
							x1={segment.from.x}
							y1={segment.from.y}
							x2={segment.to.x}
							y2={segment.to.y}
							class="adaptive-route-remaining"
							stroke-width="11"
							stroke-linecap="round"
						/>
						<line
							x1={segment.from.x}
							y1={segment.from.y}
							x2={segment.to.x}
							y2={segment.to.y}
							class="adaptive-route-guide route-dash"
							stroke-width="5"
							stroke-linecap="round"
						/>
					{/each}
					{#each adaptiveRouteSegments.completed as segment}
						<line
							x1={segment.from.x}
							y1={segment.from.y}
							x2={segment.to.x}
							y2={segment.to.y}
							class="adaptive-route-completed"
							stroke-width="8"
							stroke-linecap="round"
						/>
					{/each}
					{#each adaptiveShuttleRouteSegments.remaining as segment}
						<line
							x1={segment.from.x}
							y1={segment.from.y}
							x2={segment.to.x}
							y2={segment.to.y}
							class="adaptive-shuttle-route-remaining"
							stroke-width="10"
							stroke-linecap="round"
						/>
					{/each}
					{#each adaptiveShuttleRouteSegments.completed as segment}
						<line
							x1={segment.from.x}
							y1={segment.from.y}
							x2={segment.to.x}
							y2={segment.to.y}
							class="adaptive-shuttle-route-completed"
							stroke-width="7"
							stroke-linecap="round"
						/>
					{/each}
				</g>
				{#each adaptiveForegroundMarkers as object (object.id)}
					{@const point = pointForObject(object)}
					<g
						class={motionEnabled && object.type === 'current_location' ? 'route-motion' : ''}
						data-log-target={`map_object:${object.type}:${object.id}`}
						data-log-type={object.type}
						data-log-surface={interactionSource}
					>
						{#if object.type === 'current_location'}
							<g transform={`translate(${point.x} ${point.y})`} class="current-location-marker">
								<circle r="24" class="current-location-glow" />
								<circle r="14" class="current-location-range" />
								<circle r="7" class={objectClass(object.type)} stroke-width="3" />
							</g>
						{:else}
							<g transform={`translate(${point.x} ${point.y})`}>
								<path
									d="M0 -15 C8 -15 14 -9 14 -1 C14 8 3 17 0 20 C-3 17 -14 8 -14 -1 C-14 -9 -8 -15 0 -15 Z"
									class={objectClass(object.type)}
									stroke-width="2"
								/>
								<circle cx="0" cy="-2" r="5" class="fill-white" />
							</g>
						{/if}
						<text x={point.x + 18} y={point.y + 4} fill="#263C34" font-size="11" font-weight="600"
							>{triggerObjectLabel(object)}</text
						>
					</g>
				{/each}
			{/if}
		</svg>
		{#if interactive}
			<div class="absolute bottom-3 left-3">
				<button
					type="button"
					class="verde-focus rounded-full border border-[var(--hairline)] bg-white/95 px-3 py-1.5 text-[0.68rem] font-bold text-forest shadow-sm backdrop-blur"
					aria-label="Reset map view"
					data-log-target="map_reset_view"
					data-log-type="map_control"
					data-log-surface={interactionSource}
					onclick={handleResetView}
				>
					Reset
				</button>
			</div>
			<div class="absolute right-3 bottom-3 flex gap-1.5">
				<button
					type="button"
					class="verde-focus grid h-8 w-8 place-items-center rounded-full border border-[var(--hairline)] bg-white/95 text-base font-bold text-forest shadow-sm backdrop-blur"
					aria-label="Zoom in"
					data-log-target="map_zoom_in"
					data-log-type="map_control"
					data-log-surface={interactionSource}
					onclick={handleZoomIn}
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.6"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="M12 5v14" />
						<path d="M5 12h14" />
					</svg>
				</button>
				<button
					type="button"
					class="verde-focus grid h-8 w-8 place-items-center rounded-full border border-[var(--hairline)] bg-white/95 text-base font-bold text-forest shadow-sm backdrop-blur"
					aria-label="Zoom out"
					data-log-target="map_zoom_out"
					data-log-type="map_control"
					data-log-surface={interactionSource}
					onclick={handleZoomOut}
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.6"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="M5 12h14" />
					</svg>
				</button>
			</div>
		{/if}
	{:else}
		<div class="grid h-56 place-items-center text-corduroy">No map selected</div>
	{/if}
</div>

<style>
	.route-motion {
		transition: transform 90ms linear;
	}

	.route-dash {
		animation: route-dash 1.1s linear infinite;
		filter: drop-shadow(0 3px 7px rgba(20, 66, 46, 0.18));
	}

	.adaptive-route-remaining {
		stroke: rgba(20, 66, 46, 0.2);
		transition: all 650ms var(--ease-calm);
		filter: drop-shadow(0 5px 10px rgba(20, 66, 46, 0.16));
	}

	.adaptive-route-guide {
		stroke: #14422e;
		stroke-dasharray: 10 10;
		transition: all 650ms var(--ease-calm);
	}

	.adaptive-route-completed {
		stroke: rgba(127, 145, 137, 0.42);
		stroke-dasharray: 2 9;
		transition: all 650ms var(--ease-calm);
		filter: blur(0.2px);
	}

	.adaptive-shuttle-route-remaining {
		stroke: rgba(20, 66, 46, 0.16);
		stroke-dasharray: 8 10;
		transition: all 650ms var(--ease-calm);
	}

	.adaptive-shuttle-route-completed {
		stroke: #14422e;
		transition: all 650ms var(--ease-calm);
		filter: drop-shadow(0 4px 9px rgba(20, 66, 46, 0.18));
	}

	.shuttle-pulse {
		filter: drop-shadow(0 4px 8px rgba(20, 66, 46, 0.25));
	}

	.shuttle-ring {
		transform-box: fill-box;
		transform-origin: center;
		animation: shuttle-ring 1.6s var(--ease-calm) infinite;
	}

	.current-location-marker {
		filter: drop-shadow(0 4px 9px rgba(31, 122, 255, 0.34));
	}

	.current-location-glow {
		fill: rgba(31, 122, 255, 0.12);
		animation: location-glow 1.9s var(--ease-calm) infinite;
	}

	.current-location-range {
		fill: rgba(31, 122, 255, 0.22);
		stroke: rgba(31, 122, 255, 0.32);
		stroke-width: 1.5;
	}

	.motion-disabled .route-motion,
	.motion-disabled .adaptive-route-remaining,
	.motion-disabled .adaptive-route-guide,
	.motion-disabled .adaptive-route-completed,
	.motion-disabled .adaptive-shuttle-route-remaining,
	.motion-disabled .adaptive-shuttle-route-completed {
		transition: none;
	}

	.motion-disabled .route-dash,
	.motion-disabled .shuttle-ring,
	.motion-disabled .current-location-glow {
		animation: none;
	}

	.motion-disabled .route-dash,
	.motion-disabled .adaptive-route-remaining,
	.motion-disabled .adaptive-shuttle-route-completed,
	.motion-disabled .current-location-marker,
	.motion-disabled .shuttle-pulse {
		filter: none;
	}

	@keyframes route-dash {
		to {
			stroke-dashoffset: -20;
		}
	}

	@keyframes shuttle-ring {
		0%,
		100% {
			opacity: 0.28;
			transform: scale(0.92);
		}
		50% {
			opacity: 0.72;
			transform: scale(1.08);
		}
	}

	@keyframes location-glow {
		0%,
		100% {
			opacity: 0.58;
			transform: scale(0.88);
		}
		50% {
			opacity: 0.95;
			transform: scale(1.08);
		}
	}
</style>
