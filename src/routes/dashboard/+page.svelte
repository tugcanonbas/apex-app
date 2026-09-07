<script lang="ts">
	import { browser } from '$app/environment';
	import ParticipantRide from '$lib/components/ParticipantRide.svelte';
	import RouteMap from '$lib/components/RouteMap.svelte';
	import {
		conditionLabel,
		mapObjectTypes,
		mapTriggerTags,
		phaseLabel,
		phases,
		type ConditionOrder,
		type LocationOverride,
		type MapTriggerTag,
		type MapObjectType,
		type ParticipantRecord,
		type ParticipantSummary,
		type RideOption,
		type SicBoardingStep,
		type StateResponse,
		type StudyEvent,
		type StudyMap,
		type StudyMapInitialView,
		type StudyMapObject,
		type StudyMapViewport,
		type StudyMapViewportKey,
		type StudyPhase
	} from '$lib/types';

	let dashboardState: StateResponse = $state({
		session: null,
		map: null,
		maps: [],
		participants: [],
		live: null,
		now: ''
	});
	let participantId = $state('');
	let conditionOrder: ConditionOrder = $state('SIC_AIC');
	let selectedMapId = $state('');
	let durationSeconds = $state(300);
	let includeDelay = $state(true);
	let delayAt = $state(100);
	let nearArrivalAt = $state(260);
	let arrivalAt = $state(300);
	let revisedEtaSeconds = $state(200);
	let selectionCountdownSeconds = $state(90);
	let assignmentDurationSeconds = $state(30);
	let arrivalCompletionBufferSeconds = $state(15);
	let rideEtaAfterArrivalMinutes = $state(6);
	let participantProgressInput = $state(0);
	let participantXInput = $state(0);
	let participantYInput = $state(0);
	let participantDirectionInput = $state(0);
	let participantSpeedInput = $state(12);
	let joystickPointerId = $state<number | null>(null);
	let joystickLevel = $state<0 | 1 | 2>(0);
	let joystickDx = $state(0);
	let joystickDy = $state(0);
	let heldJoystickVector: { dx: number; dy: number; source: string } | null = null;
	let joystickAnimationFrame: number | null = null;
	let lastJoystickFrameAt = 0;
	let joystickHoldStartedAt = 0;
	let joystickHoldStartPoint: { x: number; y: number; direction: number; speed: number } | null = null;
	let pendingLiveLocationOverride: Partial<LocationOverride> | null = null;
	let pendingLiveActiveTriggerTags: MapTriggerTag[] | undefined;
	let pendingLoggedLocationOverride: Partial<LocationOverride> | null = null;
	let pendingLoggedActiveTriggerTags: MapTriggerTag[] | undefined;
	let pendingLoggedLocationSamples: Record<string, unknown>[] = [];
	let pendingLoggedLocationSource = 'joystick';
	let liveLocationTimer: number | null = null;
	let loggedLocationTimer: number | null = null;
	let lastLiveLocationSentAt = 0;
	let lastLoggedLocationSentAt = 0;
	let researcherNote = $state('');
	let technicalIssue = $state('');
	let statusMessage = $state('');
	let editMap: StudyMap | null = $state(null);
	let newObjectType: MapObjectType = $state('pickup');
	let isMapBuilderOpen = $state(false);
	let isStudySetupOpen = $state(false);
	let isParticipantModalOpen = $state(false);
	let selectedParticipantDetail: ParticipantRecord | null = $state(null);
	let selectedMapObjectId = $state('');
	let selectedViewportKey: StudyMapViewportKey = $state('default');
	let selectedRegisteredParticipantId = $state('');
	let placementTarget: 'start' | 'end' = $state('start');
	let dashboardNow = $state(Date.now());
	let showMultiplePreviews = $state(false);
	let editorSvg: SVGSVGElement | null = $state(null);

	let session = $derived(dashboardState.session);
	let hasActiveDashboardSession = $derived(Boolean(session && session.status !== 'study_finished'));
	let maps = $derived(dashboardState.maps);
	let activeMap = $derived(dashboardState.map);
	let liveState = $derived(dashboardState.live);
	const shuttleProgressLimit = 1;
	const defaultParticipantMapId = 'default-map';
	const wrongWayRouteBufferPx = 50;
	const mapViewportItems: { key: StudyMapViewportKey; label: string; stroke: string }[] = [
		{ key: 'default', label: 'Default view', stroke: '#14422E' },
		{ key: 'expanded', label: 'Expanded view', stroke: '#A74D3F' }
	];
	type DashboardPoint = { x: number; y: number };
	type LiveLocationBroadcast = {
		type: 'verde_live_location';
		sessionId: string;
		locationOverride?: LocationOverride;
		activeTriggerTags?: MapTriggerTag[];
		updatedAt: string;
	};
	let liveLocationChannel: BroadcastChannel | null = null;
	let activeBlockState = $derived(
		session?.blocks.find((block) => block.block === session.activeBlock)
	);
	let selectedRideOption = $derived(
		session?.scenario.rideOptions.find(
			(option) => option.id === activeBlockState?.selectedRideOptionId
		)
	);
	let latestEvents = $derived(session ? session.events.slice(-20).reverse() : []);
	let participantSummaries = $derived(dashboardState.participants);
	let participantRecordForInput = $derived.by((): ParticipantSummary | undefined => {
		const normalized = normalizedParticipantId(participantId);
		if (!normalized) return undefined;
		return participantSummaries.find(
			(participant) => normalizedParticipantId(participant.participantId) === normalized
		);
	});
	let participantIdAlreadyUsed = $derived(Boolean(participantRecordForInput));
	let participantIsRegistered = $derived(participantRecordForInput?.status === 'registered');
	let selectedParticipantRecord = $derived(participantRecordForInput);
	let selectedParticipantEvents = $derived.by((): StudyEvent[] => {
		if (!selectedParticipantDetail) return [];
		return selectedParticipantDetail.events.slice().reverse();
	});
	let studySetupLocked = $derived(
		Boolean(
			session || participantSummaries.some((participant) => participant.status !== 'registered')
		)
	);
	let lockedStudyScenario = $derived.by(
		() =>
			session?.scenario ??
			participantSummaries.find(
				(participant) => participant.status !== 'registered' && participant.scenario
			)?.scenario
	);
	let selectedRegisteredParticipant = $derived(
		participantSummaries.find(
			(participant) =>
				participant.status === 'registered' &&
				normalizedParticipantId(participant.participantId) ===
					normalizedParticipantId(selectedRegisteredParticipantId)
		)
	);
	let canRegisterParticipant = $derived(
		Boolean(participantId && !participantIdAlreadyUsed && !selectedRegisteredParticipantId)
	);
	let canEditRegisteredParticipant = $derived(
		Boolean(selectedRegisteredParticipant && participantId)
	);
	let studySetupStatus = $derived(
		studySetupLocked
			? 'Locked after first started study'
			: `Editable before study start · ${formatSeconds(centralSetupSeconds())} total`
	);
	let selectedMapObject = $derived.by((): StudyMapObject | null => {
		const map = editMap as StudyMap | null;
		return map?.objects.find((object: StudyMapObject) => object.id === selectedMapObjectId) ?? null;
	});
	let sortedEditMapObjects = $derived.by((): StudyMapObject[] => {
		const map = editMap as StudyMap | null;
		return [...(map?.objects ?? [])].sort(
			(left, right) =>
				(left.zIndex ?? defaultZIndex(left.type)) - (right.zIndex ?? defaultZIndex(right.type)) ||
				left.id.localeCompare(right.id)
		);
	});
	let editMapViewports = $derived.by((): Record<StudyMapViewportKey, StudyMapViewport> | null =>
		editMap ? normalizedMapViewports(editMap) : null
	);
	let editMapInitialViewport = $derived.by((): StudyMapViewportKey => {
		const map = editMap as StudyMap | null;
		return normalizeInitialView(map).viewport;
	});
	let editMapInitialView = $derived.by(
		(): StudyMapInitialView => normalizeInitialView(editMap as StudyMap | null)
	);
	let selectedViewport = $derived.by(
		(): StudyMapViewport | null => editMapViewports?.[selectedViewportKey] ?? null
	);
	let elapsedSeconds = $derived.by(() => {
		if (!session) return 0;
		if (!session.automation.startedAt) return session.automation.elapsedBeforePauseSeconds;
		const startedAt = new Date(session.automation.startedAt).getTime();
		return Math.max(
			0,
			Math.floor((dashboardNow - startedAt) / 1000) + session.automation.elapsedBeforePauseSeconds
		);
	});
	let elapsedPercent = $derived(
		session
			? Math.min(100, Math.round((elapsedSeconds / session.scenario.durationSeconds) * 100))
			: 0
	);
	let allBlocksCompleted = $derived(
		Boolean(session?.blocks.every((block) => Boolean(block.completedAt)))
	);
	let activeBlockCompleted = $derived(
		Boolean(
			activeBlockState?.completedAt ||
			session?.status === 'completed' ||
			session?.status === 'study_finished'
		)
	);
	let nextBlockState = $derived(
		session?.blocks.find((block) => block.block !== session.activeBlock)
	);
	let canPauseSession = $derived(
		Boolean(session && session.status === 'running' && !activeBlockCompleted)
	);
	let canResumeSession = $derived(
		Boolean(session && session.status === 'paused' && !activeBlockCompleted)
	);
	let canFinishBlock = $derived(
		Boolean(
			session &&
			!activeBlockCompleted &&
			(session.status === 'running' || session.status === 'paused')
		)
	);
	let canFinishStudy = $derived(
		Boolean(session && allBlocksCompleted && session.status !== 'study_finished')
	);
	let canJumpPhase = $derived(
		Boolean(
			session && !activeBlockCompleted && ['ready', 'running', 'paused'].includes(session.status)
		)
	);
	let canRevisePickupTiming = $derived(
		Boolean(
			session && !activeBlockCompleted && ['ready', 'running', 'paused'].includes(session.status)
		)
	);
	let canUseWozControls = $derived(
		Boolean(
			session && !activeBlockCompleted && ['ready', 'running', 'paused'].includes(session.status)
		)
	);
	let canUseSicBoardingControls = $derived(
		Boolean(
			session &&
			session.status !== 'study_finished' &&
			session.status !== 'cancelled' &&
			(session.phase === 'near_arrival' || session.phase === 'arrival' || activeBlockCompleted)
		)
	);
	let canShowBindingScreen = $derived(
		Boolean(
			session &&
			canUseSicBoardingControls &&
			activeBlockCompleted &&
			session.phase === 'arrival' &&
			session.sicBoardingStep
		)
	);
	let canSwitchBlock = $derived(
		Boolean(
			session &&
			activeBlockCompleted &&
			nextBlockState &&
			!nextBlockState.completedAt &&
			session.status !== 'study_finished' &&
			session.status !== 'cancelled'
		)
	);
	let canChangeStudyMap = $derived(
		!session ||
			!session.mapLocked ||
			session.status === 'cancelled' ||
			session.status === 'study_finished' ||
			allBlocksCompleted
	);
	let canStartParticipantSession = $derived(
		(!session ||
			session.status === 'cancelled' ||
			session.status === 'study_finished' ||
			allBlocksCompleted) &&
			participantIsRegistered
	);
	let timingSummary = $derived.by(() => {
		const total = centralSetupSeconds();
		const delayText = includeDelay
			? `Delay at ${formatSeconds(clampTimingOffset(delayAt, total))}`
			: 'Delay off';
		return `${delayText}, near-arrival handoff at ${formatSeconds(clampTimingOffset(nearArrivalAt, total))}, block end at ${formatSeconds(total)}.`;
	});
	let participantLocationPercent = $derived(
		Math.round((session?.locationOverride?.participantProgress ?? 0) * 100)
	);
	let participantCoordinateLabel = $derived(
		`${Math.round(participantXInput)}, ${Math.round(participantYInput)}`
	);
	let joystickLevelLabel = $derived(
		joystickLevel === 2 ? 'Move + direction' : joystickLevel === 1 ? 'Direction only' : 'Hold'
	);
	let timedShuttleProgress = $derived.by(() => {
		if (!session || session.phase === 'booking') return 0;
		const handoffSeconds = Math.max(1, session.scenario.timings.near_arrival);
		const progress = Math.min(1, Math.max(0, elapsedSeconds / handoffSeconds));
		return Math.min(shuttleProgressLimit, progress);
	});
	let timedShuttleProgressPercent = $derived(Math.round(timedShuttleProgress * 100));
	let activeTriggerTags = $derived(session?.activeTriggerTags ?? []);
	const sicBoardingSteps: { step: SicBoardingStep; label: string }[] = [
		{ step: 1, label: 'Arriving' },
		{ step: 2, label: 'Arrived' },
		{ step: 3, label: 'Hop on' },
		{ step: 4, label: 'Seat' }
	];
	let activeControlMessage = $derived.by(() => {
		if (!session) return 'Create or select a participant record, then start the session.';
		if (session.status === 'study_finished')
			return 'Study session is finished. No researcher controls are available.';
		if (session.status === 'cancelled')
			return 'Session is cancelled. Create or select another participant record to continue.';
		if (activeBlockCompleted && canSwitchBlock)
			return `Block ${session.activeBlock} is finished. Switch to Block ${nextBlockState?.block} to continue.`;
		if (activeBlockCompleted && canFinishStudy)
			return 'All blocks are finished. Finish the study session.';
		if (activeBlockCompleted)
			return `Block ${session.activeBlock} is finished. No further block controls are available.`;
		if (session.status === 'ready')
			return 'Waiting for the participant ride request, or jump to assignment if intervention is needed.';
		if (session.status === 'paused')
			return 'Automation is paused. Resume before continuing the timed flow, or use a controlled phase jump.';
		if (session.status === 'running')
			return 'Timed block is running. Pause, finish, or use controlled overrides only if needed.';
		return 'Review the active session state before using researcher controls.';
	});

	function cloneMap(map: StudyMap): StudyMap {
		return normalizeEditMap(JSON.parse(JSON.stringify(map)) as StudyMap);
	}

	function defaultMapViewports(
		width: number,
		height: number
	): Record<StudyMapViewportKey, StudyMapViewport> {
		return {
			default: { x: 0, y: 0, width, height, label: 'Default view' },
			expanded: { x: 0, y: 0, width, height, label: 'Expanded view' }
		};
	}

	function normalizeViewport(
		viewport: Partial<StudyMapViewport> | undefined,
		fallback: StudyMapViewport
	): StudyMapViewport {
		return {
			x: Number(viewport?.x ?? fallback.x),
			y: Number(viewport?.y ?? fallback.y),
			width: Math.max(1, Number(viewport?.width ?? fallback.width)),
			height: Math.max(1, Number(viewport?.height ?? fallback.height)),
			label: viewport?.label ?? fallback.label
		};
	}

	function normalizedMapViewports(map: StudyMap): Record<StudyMapViewportKey, StudyMapViewport> {
		const defaults = defaultMapViewports(map.width, map.height);
		return {
			default: normalizeViewport(map.viewports?.default, defaults.default),
			expanded: normalizeViewport(map.viewports?.expanded, defaults.expanded)
		};
	}

	function normalizeInitialView(map: StudyMap | null): StudyMapInitialView {
		const viewport: StudyMapViewportKey =
			map?.initialView?.viewport === 'expanded' || map?.initialViewport === 'expanded'
				? 'expanded'
				: 'default';
		return {
			viewport,
			zoom: Math.min(4, Math.max(1, Number(map?.initialView?.zoom ?? 1))),
			panX: Number(map?.initialView?.panX ?? 0),
			panY: Number(map?.initialView?.panY ?? 0)
		};
	}

	function normalizeEditMap(map: StudyMap): StudyMap {
		const initialView = normalizeInitialView(map);
		return {
			...map,
			initialViewport: initialView.viewport,
			initialView,
			viewports: normalizedMapViewports(map)
		};
	}

	function normalizedParticipantId(value: string): string {
		return value
			.trim()
			.replace(/[^a-zA-Z0-9._-]+/g, '_')
			.replace(/^_+|_+$/g, '');
	}

	function blankMap(): StudyMap {
		const timestamp = new Date().toISOString();
		return {
			id: `study-map-${Date.now().toString(36)}`,
			name: `Study Map ${maps.length + 1}`,
			roomLabel: 'Study room',
			width: 390,
			height: 320,
			initialViewport: 'default',
			initialView: { viewport: 'default', zoom: 1, panX: 0, panY: 0 },
			viewports: defaultMapViewports(390, 320),
			objects: [],
			createdAt: timestamp,
			updatedAt: timestamp
		};
	}

	function formatSeconds(value: number): string {
		const minutes = Math.floor(value / 60);
		const seconds = value % 60;
		if (minutes === 0) return `${seconds}s`;
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	function centralSetupSeconds(): number {
		return Math.max(30, Number(arrivalAt || durationSeconds));
	}

	function clampTimingOffset(value: number, total: number): number {
		return Math.max(0, Math.min(Number(value), total));
	}

	function conditionChipClass(): string {
		if (!session) return '';
		return session.activeCondition === 'aic'
			? 'bg-leaf text-white border-leaf'
			: 'bg-forest text-white border-forest';
	}

	function phaseChipClass(): string {
		if (!session) return '';
		if (session.phase === 'delay') return 'bg-attention text-white border-attention';
		if (session.phase === 'arrival') return 'bg-leaf text-white border-leaf';
		return 'bg-mint text-forest border-[var(--hairline-strong)]';
	}

	function conditionOrderLabel(order: ConditionOrder): string {
		return order === 'SIC_AIC' ? 'Static (SIC) → Adaptive (AIC)' : 'Adaptive (AIC) → Static (SIC)';
	}

	function mapNameForId(mapId: string): string {
		return maps.find((map) => map.id === mapId)?.name ?? mapId;
	}

	function rideOptionWaitMinutes(option: RideOption | undefined): number {
		const basePickupSeconds =
			session?.scenario.initialEtaSeconds ??
			(includeDelay ? Math.max(30, arrivalAt - delayAt) : arrivalAt);
		if (!option) return Math.max(1, Math.ceil(basePickupSeconds / 60));
		const options = session?.scenario.rideOptions ?? [];
		const minimumOptionWait = Math.min(...options.map((item) => item.waitMinutes));
		const baseEta = Math.max(1, Math.ceil(basePickupSeconds / 60));
		return Math.max(1, baseEta + option.waitMinutes - minimumOptionWait);
	}

	function clampNumber(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	function normalizeDegrees(value: number): number {
		return Math.round(((value % 360) + 360) % 360);
	}

	function directionDegreesFromVector(dx: number, dy: number): number {
		return normalizeDegrees((Math.atan2(dx, -dy) * 180) / Math.PI);
	}

	function distanceBetween(left: DashboardPoint, right: DashboardPoint): number {
		return Math.hypot(right.x - left.x, right.y - left.y);
	}

	function distanceToSegment(
		point: DashboardPoint,
		from: DashboardPoint,
		to: DashboardPoint
	): number {
		const segmentLengthSquared = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
		if (segmentLengthSquared <= 0) return distanceBetween(point, from);
		const projection = Math.max(
			0,
			Math.min(
				1,
				((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) /
					segmentLengthSquared
			)
		);
		return distanceBetween(point, {
			x: from.x + (to.x - from.x) * projection,
			y: from.y + (to.y - from.y) * projection
		});
	}

	function distanceToDashboardRoute(point: DashboardPoint, points: DashboardPoint[]): number {
		if (points.length <= 1) return Number.POSITIVE_INFINITY;
		return points
			.slice(0, -1)
			.reduce(
				(minimum, from, index) =>
					Math.min(minimum, distanceToSegment(point, from, points[index + 1])),
				Number.POSITIVE_INFINITY
			);
	}

	function distanceToDashboardPathObjects(point: DashboardPoint, map: StudyMap): number {
		const pathObjects = map.objects.filter((object) => object.type === 'path');
		if (pathObjects.length === 0) return Number.POSITIVE_INFINITY;
		return pathObjects.reduce(
			(minimum, pathObject) =>
				Math.min(
					minimum,
					distanceToSegment(
						point,
						{ x: pathObject.x, y: pathObject.y },
						{
							x: pathObject.x2 ?? pathObject.x,
							y: pathObject.y2 ?? pathObject.y
						}
					)
				),
			Number.POSITIVE_INFINITY
		);
	}

	function containsDashboardPointWithBuffer(
		zone: StudyMapObject,
		point: DashboardPoint,
		buffer = 0
	): boolean {
		const width = zone.width ?? 80;
		const height = zone.height ?? 48;
		return (
			point.x >= zone.x - buffer &&
			point.x <= zone.x + width + buffer &&
			point.y >= zone.y - buffer &&
			point.y <= zone.y + height + buffer
		);
	}

	function normalizedDashboardZoneLabel(zone: StudyMapObject): string {
		return zone.label
			.trim()
			.toLowerCase()
			.replace(/[\s_]+/g, '-');
	}

	function inferredDashboardZoneTriggerTags(zone: StudyMapObject): MapTriggerTag[] {
		if (zone.triggerTags?.length) return zone.triggerTags;
		if (zone.type !== 'zone') return [];
		const label = normalizedDashboardZoneLabel(zone);
		if (label.includes('path-area-1')) return ['participant_route_start', 'path_area_1_enter'];
		if (label.includes('path-area-2')) return ['path_area_2_enter'];
		if (label.includes('path-area-3')) return ['participant_midroute_enter', 'path_area_3_enter'];
		if (label.includes('path-area-4')) return ['path_area_4_enter'];
		if (label.includes('waiting-area') || label.includes('waiting-zone')) {
			return ['participant_waiting_zone_enter', 'participant_waiting_zone_exit'];
		}
		if (
			label.includes('boarding-area') ||
			label.includes('boarding-zone') ||
			label.includes('pickup-area') ||
			label.includes('pickup-zone')
		) {
			return ['pickup_zone_enter', 'pickup_zone_exit', 'boarding_zone_enter', 'boarding_zone_exit'];
		}
		if (label.includes('shuttle-arriving') || label.includes('shuttle-approach')) {
			return ['shuttle_arriving_zone_enter', 'shuttle_arriving_zone_exit'];
		}
		return [];
	}

	function triggerEmoji(tag: MapTriggerTag): string {
		if (tag.includes('wrong_way') || tag.includes('_exit')) return '⚠️';
		if (tag.includes('shuttle_arriving')) return '🚌';
		if (tag.includes('boarding')) return '✅';
		if (tag.includes('waiting')) return '⏳';
		if (tag.includes('path_area') || tag.includes('route') || tag.includes('midroute')) return '🧭';
		if (tag.includes('pickup')) return '📍';
		if (tag.includes('delay') || tag.includes('eta')) return '⏱️';
		return '🎯';
	}

	function eventEmoji(type: string): string {
		const normalizedType = type.toLowerCase();
		if (
			normalizedType.includes('wrong') ||
			normalizedType.includes('issue') ||
			normalizedType.includes('error') ||
			normalizedType.includes('failed') ||
			normalizedType.includes('unavailable')
		) {
			return '⚠️';
		}
		if (normalizedType.includes('delay') || normalizedType.includes('eta')) return '⏱️';
		if (normalizedType.includes('location') || normalizedType.includes('joystick')) return '📍';
		if (normalizedType.includes('map') || normalizedType.includes('route')) return '🗺️';
		if (normalizedType.includes('trigger')) return '🎯';
		if (
			normalizedType.includes('notification') ||
			normalizedType.includes('audio') ||
			normalizedType.includes('haptic') ||
			normalizedType.includes('feedback')
		) {
			return '🔔';
		}
		if (
			normalizedType.includes('ride') ||
			normalizedType.includes('assignment') ||
			normalizedType.includes('vehicle') ||
			normalizedType.includes('shuttle')
		) {
			return '🚌';
		}
		if (normalizedType.includes('boarding')) return '✅';
		if (
			normalizedType.includes('block') ||
			normalizedType.includes('session') ||
			normalizedType.includes('study')
		) {
			return '🏁';
		}
		if (normalizedType.includes('note')) return '📝';
		if (normalizedType.includes('screen') || normalizedType.includes('phase')) return '👁️';
		return '📌';
	}

	function pushDashboardRoutePoint(points: DashboardPoint[], point: DashboardPoint) {
		const previous = points.at(-1);
		if (!previous || distanceBetween(previous, point) > 1) points.push(point);
	}

	function pickupCode(value: string | undefined): string {
		return value?.match(/pickup\s*(point\s*)?([a-z])/i)?.[2]?.toLowerCase() ?? '';
	}

	function selectedDashboardPickupObject(map: StudyMap): StudyMapObject | undefined {
		const pickups = map.objects.filter((object) => object.type === 'pickup');
		const selectedCode = pickupCode(selectedRideOption?.pickupPoint);
		return pickups.find((object) => pickupCode(object.label) === selectedCode) ?? pickups[0];
	}

	function dashboardRoutePoints(map: StudyMap): DashboardPoint[] {
		const currentObject = map.objects.find((object) => object.type === 'current_location');
		const startObject =
			map.objects.find((object) => object.type === 'participant_start') ?? currentObject;
		if (!startObject) return [{ x: map.width / 2, y: map.height / 2 }];
		const targetObject = selectedDashboardPickupObject(map);
		const pathObjects = [...map.objects.filter((object) => object.type === 'path')];
		const points: DashboardPoint[] = [{ x: startObject.x, y: startObject.y }];
		let cursor: DashboardPoint = { x: startObject.x, y: startObject.y };

		while (pathObjects.length > 0) {
			let bestIndex = 0;
			let bestReversed = false;
			let bestDistance = Number.POSITIVE_INFINITY;
			for (const [index, pathObject] of pathObjects.entries()) {
				const startDistance = distanceBetween(cursor, { x: pathObject.x, y: pathObject.y });
				const endDistance = distanceBetween(cursor, {
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
			pushDashboardRoutePoint(points, routeStart);
			pushDashboardRoutePoint(points, routeEnd);
			cursor = routeEnd;
		}

		if (targetObject) pushDashboardRoutePoint(points, { x: targetObject.x, y: targetObject.y });
		return points;
	}

	function pointAlongDashboardRoute(map: StudyMap, progress: number): DashboardPoint {
		const points = dashboardRoutePoints(map);
		if (points.length <= 1) return points[0] ?? { x: map.width / 2, y: map.height / 2 };
		const segments = points.slice(0, -1).map((point, index) => ({
			from: point,
			to: points[index + 1],
			length: distanceBetween(point, points[index + 1])
		}));
		const totalLength = segments.reduce((total, segment) => total + segment.length, 0);
		if (totalLength <= 0) return points[0];
		let remaining = totalLength * clampNumber(progress, 0, 1);
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

	function fallbackParticipantPoint(): DashboardPoint {
		const map = activeMap;
		if (!map) return { x: 0, y: 0 };
		return pointAlongDashboardRoute(map, session?.locationOverride?.participantProgress ?? 0);
	}

	function currentParticipantPoint(): DashboardPoint {
		if (
			typeof session?.locationOverride?.participantX === 'number' &&
			typeof session.locationOverride.participantY === 'number'
		) {
			return {
				x: session.locationOverride.participantX,
				y: session.locationOverride.participantY
			};
		}
		return fallbackParticipantPoint();
	}

	function activeTriggerTagsForLocation(patch: Partial<LocationOverride>): MapTriggerTag[] {
		const phaseTags = (session?.activeTriggerTags ?? []).filter(
			(tag) =>
				tag === 'delay_notice_shown' ||
				tag === 'revised_eta_acknowledged' ||
				tag.startsWith('shuttle_')
		);
		const active = new Set<MapTriggerTag>(phaseTags);
		const map = activeMap;
		if (!map) return [...active];
		const mergedLocation = {
			...session?.locationOverride,
			...dashboardState.live?.locationOverride,
			...pendingLiveLocationOverride,
			...patch
		};
		const point =
			typeof mergedLocation.participantX === 'number' &&
			typeof mergedLocation.participantY === 'number'
				? { x: mergedLocation.participantX, y: mergedLocation.participantY }
				: currentParticipantPoint();
		const isWrongWay = distanceToDashboardPathObjects(point, map) > wrongWayRouteBufferPx;
		if (isWrongWay) active.add('participant_wrong_way');

		for (const zone of map.objects.filter((object) => object.type === 'zone')) {
			const triggerTags = inferredDashboardZoneTriggerTags(zone).filter(
				(tag) => !tag.startsWith('shuttle_')
			);
			if (triggerTags.length === 0) continue;
			const inside = containsDashboardPointWithBuffer(zone, point);
			const wasInside = Boolean(session?.triggerZoneState?.[zone.id]);
			for (const tag of triggerTags) {
				if (tag.endsWith('_enter')) {
					if (inside) active.add(tag);
				} else if (tag.endsWith('_exit')) {
					if (wasInside && !inside) active.add(tag);
				} else if (inside) {
					active.add(tag);
				}
			}
		}
		return [...active];
	}

	function liveLocationChannelForDashboard(): BroadcastChannel | null {
		if (!browser || typeof BroadcastChannel === 'undefined') return null;
		liveLocationChannel ??= new BroadcastChannel('verde-live-location');
		return liveLocationChannel;
	}

	function broadcastLiveLocation(
		locationOverride: Partial<LocationOverride>,
		activeTriggerTags: MapTriggerTag[]
	) {
		if (!session) return;
		const message: LiveLocationBroadcast = {
			type: 'verde_live_location',
			sessionId: session.sessionId,
			locationOverride,
			activeTriggerTags,
			updatedAt: new Date().toISOString()
		};
		liveLocationChannelForDashboard()?.postMessage(message);
	}

	function joystickKnobStyle(): string {
		return `transform: translate(calc(-50% + ${joystickDx}px), calc(-50% + ${joystickDy}px));`;
	}

	function statusChipClass(): string {
		if (!session) return '';
		if (session.status === 'running') return 'bg-leaf text-white border-leaf';
		if (session.status === 'paused') return 'bg-attention text-white border-attention';
		if (session.status === 'study_finished') return 'bg-forest text-white border-forest';
		if (session.status === 'cancelled') return 'bg-critical text-white border-critical';
		return 'bg-white text-forest border-[var(--hairline)]';
	}

	function previewScrollStyle(): string {
		const scrollY = liveState?.scroll?.scrollY ?? 0;
		return `transform: translate3d(0, -${scrollY}px, 0);`;
	}

	function previewConditions(): ('sic' | 'aic')[] {
		if (showMultiplePreviews) return ['sic', 'aic'];
		return [session?.activeCondition ?? 'sic'];
	}

	function previewTitle(condition: 'sic' | 'aic'): string {
		return condition === 'sic' ? 'Static preview' : 'Adaptive preview';
	}

	function previewBorderClass(condition: 'sic' | 'aic'): string {
		if (condition !== session?.activeCondition) return 'border-[var(--hairline)]';
		return condition === 'aic' ? 'border-leaf' : 'border-forest';
	}

	function confirmAction(message: string): boolean {
		if (!browser) return true;
		return window.confirm(message);
	}

	function handleDurationInput(value: string) {
		const nextDuration = Math.max(30, Number(value));
		const nextDelay = Math.max(0, Math.round(nextDuration / 3));
		durationSeconds = nextDuration;
		revisedEtaSeconds = Math.max(30, nextDuration - nextDelay);
		arrivalAt = nextDuration;
		delayAt = nextDelay;
		nearArrivalAt = nextDuration;
	}

	function objectTypeLabel(type: MapObjectType): string {
		return type.replaceAll('_', ' ');
	}

	function isLineType(type: MapObjectType): boolean {
		return (
			type === 'wall' ||
			type === 'road' ||
			type === 'pedestrian_road' ||
			type === 'path' ||
			type === 'shuttle_path'
		);
	}

	function isLineObject(object: StudyMapObject | null): boolean {
		return Boolean(object && isLineType(object.type));
	}

	function isRectangleObject(object: StudyMapObject | null): boolean {
		return object?.type === 'zone' || object?.type === 'obstacle';
	}

	function usesSize(object: StudyMapObject | null): boolean {
		return Boolean(object) && !isRectangleObject(object);
	}

	function defaultZIndex(type: MapObjectType): number {
		if (type === 'obstacle' || type === 'zone') return 0;
		if (type === 'road') return 10;
		if (type === 'pedestrian_road') return 20;
		if (type === 'wall') return 30;
		if (type === 'shuttle_path') return 40;
		if (type === 'shuttle') return 50;
		if (type === 'path') return 70;
		if (type === 'participant_start' || type === 'label') return 80;
		if (type === 'pickup' || type === 'current_location') return 90;
		return 50;
	}

	function mapObjectStyle(object: StudyMapObject): string {
		if (object.id === selectedMapObjectId) return 'stroke-critical fill-critical/20';
		if (object.type === 'pickup') return 'fill-leaf stroke-forest';
		if (object.type === 'participant_start' || object.type === 'current_location')
			return 'fill-mint stroke-forest';
		if (object.type === 'shuttle') return 'fill-forest stroke-forest';
		if (object.type === 'obstacle') return 'fill-attention/20 stroke-attention';
		if (object.type === 'zone')
			return object.triggerTags?.length
				? 'fill-attention/20 stroke-attention'
				: 'fill-mint/45 stroke-leaf/40';
		if (object.type === 'road') return 'stroke-[#D9E3DF]';
		if (object.type === 'pedestrian_road') return 'stroke-[#E8F4EF]';
		if (object.type === 'shuttle_path') return 'stroke-forest';
		return 'stroke-corduroy';
	}

	function getObjectSize(type: MapObjectType): number {
		if (type === 'wall') return 5;
		if (type === 'road') return 26;
		if (type === 'pedestrian_road') return 18;
		if (type === 'path') return 6;
		if (type === 'shuttle_path') return 7;
		if (type === 'label') return 13;
		if (type === 'shuttle') return 15;
		return 11;
	}

	function handleOpenMapBuilder() {
		const map = maps.find((item: StudyMap) => item.id === selectedMapId) ?? activeMap ?? maps[0];
		if (map) {
			editMap = cloneMap(map);
			selectedMapObjectId = editMap.objects[0]?.id ?? '';
			selectedViewportKey = editMap.initialViewport ?? 'default';
		}
		isMapBuilderOpen = true;
	}

	function participantMapId(): string {
		return defaultParticipantMapId;
	}

	function updateMapMeta(
		field: 'id' | 'name' | 'roomLabel' | 'width' | 'height',
		value: string | number
	) {
		if (!editMap) return;
		const nextMap = { ...editMap, [field]: typeof value === 'number' ? value : value };
		if (field === 'width' || field === 'height') {
			const nextWidth = field === 'width' ? Number(value) : editMap.width;
			const nextHeight = field === 'height' ? Number(value) : editMap.height;
			const viewports = normalizedMapViewports(editMap);
			nextMap.viewports = {
				default: viewports.default,
				expanded: {
					...viewports.expanded,
					width:
						viewports.expanded.x === 0 && viewports.expanded.width === editMap.width
							? nextWidth
							: viewports.expanded.width,
					height:
						viewports.expanded.y === 0 && viewports.expanded.height === editMap.height
							? nextHeight
							: viewports.expanded.height
				}
			};
		}
		editMap = normalizeEditMap(nextMap);
	}

	function updateMapViewport(key: StudyMapViewportKey, patch: Partial<StudyMapViewport>) {
		if (!editMap) return;
		const viewports = normalizedMapViewports(editMap);
		editMap = normalizeEditMap({
			...editMap,
			viewports: {
				...viewports,
				[key]: normalizeViewport({ ...viewports[key], ...patch }, viewports[key])
			}
		});
	}

	function updateInitialViewport(key: StudyMapViewportKey) {
		if (!editMap) return;
		const current = normalizeInitialView(editMap);
		editMap = normalizeEditMap({
			...editMap,
			initialViewport: key,
			initialView: { ...current, viewport: key }
		});
	}

	function updateInitialView(patch: Partial<StudyMapInitialView>) {
		if (!editMap) return;
		const nextInitialView = { ...normalizeInitialView(editMap), ...patch };
		editMap = normalizeEditMap({
			...editMap,
			initialViewport: nextInitialView.viewport,
			initialView: nextInitialView
		});
	}

	function resetInitialViewTransform() {
		updateInitialView({ zoom: 1, panX: 0, panY: 0 });
	}

	function useFullCanvasForViewport(key: StudyMapViewportKey) {
		if (!editMap) return;
		updateMapViewport(key, { x: 0, y: 0, width: editMap.width, height: editMap.height });
	}

	function viewportStroke(key: StudyMapViewportKey): string {
		return mapViewportItems.find((item) => item.key === key)?.stroke ?? '#14422E';
	}

	function viewportStrokeWidth(key: StudyMapViewportKey): number {
		return key === selectedViewportKey ? 4 : 2.5;
	}

	function updateMapObject(id: string, patch: Partial<StudyMapObject>) {
		if (!editMap) return;
		editMap = {
			...editMap,
			objects: editMap.objects.map((object: StudyMapObject) =>
				object.id === id ? { ...object, ...patch } : object
			)
		};
	}

	function toggleMapObjectTrigger(id: string, tag: MapTriggerTag) {
		if (!selectedMapObject) return;
		const currentTags = selectedMapObject.triggerTags ?? [];
		const triggerTags = currentTags.includes(tag)
			? currentTags.filter((item) => item !== tag)
			: [...currentTags, tag];
		updateMapObject(id, { triggerTags });
	}

	function toggleTriggerVisibilityList(
		id: string,
		field: 'showWhenTriggers' | 'hideWhenTriggers',
		tag: MapTriggerTag
	) {
		if (!selectedMapObject) return;
		const currentTags = selectedMapObject[field] ?? [];
		const nextTags = currentTags.includes(tag)
			? currentTags.filter((item) => item !== tag)
			: [...currentTags, tag];
		updateMapObject(id, { [field]: nextTags });
	}

	function handleEditorCanvasClick(event: MouseEvent) {
		if (!editMap || !selectedMapObject || !editorSvg) return;
		const bounds = editorSvg.getBoundingClientRect();
		const x = Math.round(((event.clientX - bounds.left) / bounds.width) * editMap.width);
		const y = Math.round(((event.clientY - bounds.top) / bounds.height) * editMap.height);
		if (isLineObject(selectedMapObject) && placementTarget === 'end') {
			updateMapObject(selectedMapObject.id, { x2: x, y2: y });
			return;
		}
		updateMapObject(selectedMapObject.id, { x, y });
	}

	function stateWithLiveLocation(state: StateResponse): StateResponse {
		if (!state.session || (!state.live?.locationOverride && !state.live?.activeTriggerTags))
			return state;
		if (state.live.sessionId !== state.session.sessionId) return state;
		const liveMatchesCurrentPhase =
			state.live.block === state.session.activeBlock && state.live.phase === state.session.phase;
		return {
			...state,
			session: {
				...state.session,
				locationOverride: state.live.locationOverride
					? {
							...state.session.locationOverride,
							...state.live.locationOverride
						}
					: state.session.locationOverride,
				activeTriggerTags:
					liveMatchesCurrentPhase && state.live.activeTriggerTags
						? state.live.activeTriggerTags
						: state.session.activeTriggerTags
			}
		};
	}

	function applyOptimisticLocationOverride(
		patch: Partial<LocationOverride>,
		activeTriggerTags?: MapTriggerTag[]
	) {
		if (!dashboardState.session) return;
		const timestamp = new Date().toISOString();
		dashboardState = {
			...dashboardState,
			session: {
				...dashboardState.session,
				locationOverride: {
					...dashboardState.session.locationOverride,
					...patch,
					updatedAt: timestamp
				},
				activeTriggerTags: activeTriggerTags ?? dashboardState.session.activeTriggerTags
			},
			live: dashboardState.live
				? {
						...dashboardState.live,
						locationOverride: {
							...dashboardState.live.locationOverride,
							...patch,
							updatedAt: timestamp
						},
						activeTriggerTags: activeTriggerTags ?? dashboardState.live.activeTriggerTags,
						updatedAt: timestamp
					}
				: dashboardState.live
		};
	}

	async function refresh() {
		const response = await fetch('/api/state');
		dashboardState = stateWithLiveLocation((await response.json()) as StateResponse);
		if (!selectedMapId && dashboardState.maps[0]) selectedMapId = dashboardState.maps[0].id;
		if (!editMap && dashboardState.maps[0]) editMap = cloneMap(dashboardState.maps[0]);
	}

	async function postJson(url: string, body: unknown) {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.error ?? 'Request failed');
		await refresh();
		return result;
	}

	async function postJsonWithoutRefresh(url: string, body: unknown) {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.error ?? 'Request failed');
		return result;
	}

	function postDashboardEvent(type: string, payload: Record<string, unknown> = {}) {
		if (!session || session.status === 'study_finished' || session.status === 'cancelled') return;
		void postJsonWithoutRefresh('/api/session/event', {
			type,
			source: 'dashboard',
			payload: {
				screen: 'dashboard',
				block: session.activeBlock,
				condition: session.activeCondition,
				phase: session.phase,
				clientTimestamp: new Date().toISOString(),
				...payload
			}
		}).catch((error) => {
			statusMessage = (error as Error).message;
		});
	}

	async function putJson(url: string, body: unknown) {
		const response = await fetch(url, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.error ?? 'Request failed');
		await refresh();
		return result;
	}

	async function deleteJson(url: string) {
		const response = await fetch(url, { method: 'DELETE' });
		const result = await response.json();
		if (!response.ok) throw new Error(result.error ?? 'Request failed');
		await refresh();
		return result;
	}

	async function loadParticipantDetail(participantIdValue: string) {
		try {
			const response = await fetch(`/api/participants/${encodeURIComponent(participantIdValue)}`);
			const result = await response.json();
			if (!response.ok) throw new Error(result.error ?? 'Participant detail request failed');
			selectedParticipantDetail = result.participant as ParticipantRecord;
		} catch (error) {
			selectedParticipantDetail = null;
			statusMessage = (error as Error).message;
		}
	}

	function scenarioPayload() {
		if (studySetupLocked && lockedStudyScenario) return lockedStudyScenario;
		const centralArrival = centralSetupSeconds();
		const centralDelay = clampTimingOffset(delayAt, centralArrival);
		const centralNearArrival = clampTimingOffset(nearArrivalAt, centralArrival);
		const visiblePickupEta = includeDelay
			? Math.max(30, centralArrival - centralDelay)
			: centralArrival;
		return {
			durationSeconds: centralArrival,
			includeDelay,
			initialEtaSeconds: visiblePickupEta,
			revisedEtaSeconds: visiblePickupEta,
			selectionCountdownSeconds,
			assignmentDurationSeconds,
			arrivalCompletionBufferSeconds,
			rideEtaAfterArrivalMinutes,
			timings: {
				delay: centralDelay,
				near_arrival: centralNearArrival,
				arrival: centralArrival
			}
		};
	}

	function handleOpenStudySetup() {
		if (lockedStudyScenario) applyScenarioToSetup(lockedStudyScenario);
		isStudySetupOpen = true;
	}

	function handleSaveStudySetup() {
		if (studySetupLocked) {
			statusMessage = 'Study setup is locked because at least one study session has started.';
			return;
		}
		isStudySetupOpen = false;
		statusMessage = `Study setup ready: ${timingSummary}`;
	}

	function handleOpenAddParticipant() {
		selectedRegisteredParticipantId = '';
		participantId = '';
		conditionOrder = 'SIC_AIC';
		selectedMapId = defaultParticipantMapId;
		selectedParticipantDetail = null;
		isParticipantModalOpen = true;
		statusMessage = '';
	}

	async function handleOpenEditParticipant(participant: ParticipantSummary) {
		participantId = participant.participantId;
		conditionOrder = participant.conditionOrder;
		selectedMapId = participant.selectedMapId;
		selectedRegisteredParticipantId =
			participant.status === 'registered' ? participant.participantId : '';
		if (!studySetupLocked) applyScenarioToSetup(participant.scenario);
		await loadParticipantDetail(participant.participantId);
		isParticipantModalOpen = true;
		statusMessage = '';
	}

	function applyScenarioToSetup(scenario: ParticipantSummary['scenario']) {
		if (!scenario) return;
		durationSeconds = scenario.durationSeconds;
		includeDelay = scenario.includeDelay;
		revisedEtaSeconds = scenario.timings.arrival;
		selectionCountdownSeconds = scenario.selectionCountdownSeconds;
		assignmentDurationSeconds = scenario.assignmentDurationSeconds;
		arrivalCompletionBufferSeconds = scenario.arrivalCompletionBufferSeconds;
		rideEtaAfterArrivalMinutes = scenario.rideEtaAfterArrivalMinutes;
		delayAt = scenario.timings.delay;
		nearArrivalAt = scenario.timings.near_arrival;
		arrivalAt = scenario.timings.arrival;
	}

	async function handleRegisterParticipant() {
		if (
			!confirmAction(
				`Register participant "${participantId.trim()}" with condition order ${conditionOrderLabel(conditionOrder)}? No study session will start yet.`
			)
		) {
			return;
		}
		try {
			await postJson('/api/participants', {
				participantId,
				conditionOrder,
				selectedMapId: participantMapId(),
				scenario: scenarioPayload()
			});
			selectedRegisteredParticipantId = participantId;
			await loadParticipantDetail(participantId);
			isParticipantModalOpen = false;
			statusMessage =
				'Participant registered. Start the session later when the study block begins.';
		} catch (error) {
			statusMessage = (error as Error).message;
		}
	}

	async function handleUpdateRegisteredParticipant() {
		if (!selectedRegisteredParticipant) return;
		if (
			!confirmAction(
				`Save edits to registered participant "${selectedRegisteredParticipant.participantId}"? This can only be done before the study session starts.`
			)
		) {
			return;
		}
		try {
			await putJson(
				`/api/participants/${encodeURIComponent(selectedRegisteredParticipant.participantId)}`,
				{
					participantId,
					conditionOrder,
					selectedMapId: participantMapId(),
					scenario: scenarioPayload()
				}
			);
			selectedRegisteredParticipantId = participantId;
			await loadParticipantDetail(participantId);
			isParticipantModalOpen = false;
			statusMessage = 'Registered participant record updated.';
		} catch (error) {
			statusMessage = (error as Error).message;
		}
	}

	async function handleDeleteRegisteredParticipant(
		participant: ParticipantSummary = selectedRegisteredParticipant as ParticipantSummary
	) {
		if (!participant) return;
		if (
			!confirmAction(
				`Remove registered participant "${participant.participantId}"? This deletes only the not-started record.`
			)
		) {
			return;
		}
		try {
			await deleteJson(`/api/participants/${encodeURIComponent(participant.participantId)}`);
			if (
				normalizedParticipantId(selectedRegisteredParticipantId) ===
				normalizedParticipantId(participant.participantId)
			) {
				selectedRegisteredParticipantId = '';
				participantId = '';
			}
			selectedParticipantDetail = null;
			isParticipantModalOpen = false;
			statusMessage = 'Registered participant record removed.';
		} catch (error) {
			statusMessage = (error as Error).message;
		}
	}

	async function handleStartSession() {
		if (
			!confirmAction(
				`Start the registered participant session for "${participantId.trim()}" now? The participant app will enter booking.`
			)
		) {
			return;
		}
		try {
			await postJson('/api/session/start', {
				participantId,
				conditionOrder,
				selectedMapId: participantMapId(),
				scenario: scenarioPayload()
			});
			statusMessage = 'Session started.';
		} catch (error) {
			statusMessage = (error as Error).message;
		}
	}

	async function handleAutomation(action: string, phase?: StudyPhase) {
		if (action === 'pause' && !canPauseSession) {
			statusMessage = activeControlMessage;
			return;
		}
		if (action === 'resume' && !canResumeSession) {
			statusMessage = activeControlMessage;
			return;
		}
		if (action === 'finish' && !canFinishBlock) {
			statusMessage = activeControlMessage;
			return;
		}
		if (action === 'finish_study' && !canFinishStudy) {
			statusMessage = activeControlMessage;
			return;
		}
		if (action === 'jump' && !canJumpPhase) {
			statusMessage = activeControlMessage;
			return;
		}
		if (
			action === 'finish' &&
			!confirmAction(
				'Finish the active block now? The participant will see the study block finished screen.'
			)
		)
			return;
		if (
			action === 'finish_study' &&
			!confirmAction('Finish the whole study session now? This marks all blocks complete.')
		)
			return;
		if (
			action === 'jump' &&
			phase &&
			!confirmAction(`Jump the active block to ${phaseLabel(phase)}?`)
		)
			return;
		try {
			await postJson('/api/session/automation', { action, phase });
			statusMessage = action === 'finish' ? 'Active block finished.' : '';
		} catch (error) {
			statusMessage = (error as Error).message;
		}
	}

	async function handleJumpPhase(phase: StudyPhase) {
		await handleAutomation('jump', phase);
	}

	async function handleUpdate(payload: Record<string, unknown>) {
		await postJson('/api/session/update', payload);
	}

	async function handleSicBoardingStep(step: SicBoardingStep) {
		if (!canUseSicBoardingControls) {
			statusMessage = activeControlMessage;
			return;
		}
		await handleUpdate({
			phase: 'arrival',
			sicBoardingStep: step,
			eventType: 'sic_boarding_step_changed',
			payload: { sicBoardingStep: step, source: 'dashboard_boarding_controls' }
		});
		statusMessage = `SIC boarding screen ${step} shown.`;
	}

	async function handleShowBindingScreen() {
		if (!canShowBindingScreen) {
			statusMessage = activeBlockCompleted
				? 'The between-block screen is already shown.'
				: 'The between-block screen appears after the near-arrival buffer finishes.';
			return;
		}
		await handleUpdate({
			phase: 'near_arrival',
			sicBoardingStep: null,
			eventType: 'sic_boarding_returned_to_binding',
			payload: { source: 'dashboard_boarding_controls' }
		});
		statusMessage = 'Between-block screen shown.';
	}

	async function handleSwitchBlock() {
		if (!session) return;
		if (!canSwitchBlock) {
			statusMessage = activeControlMessage;
			return;
		}
		const nextBlock = session.activeBlock === 1 ? 2 : 1;
		if (!confirmAction(`Switch dashboard and participant app to Block ${nextBlock}?`)) return;
		await handleUpdate({ activeBlock: nextBlock, eventType: 'block_switched' });
	}

	async function handleUseParticipant(participant: ParticipantSummary) {
		participantId = participant.participantId;
		conditionOrder = participant.conditionOrder;
		selectedMapId = participant.selectedMapId;
		selectedRegisteredParticipantId =
			participant.status === 'registered' ? participant.participantId : '';
		await loadParticipantDetail(participant.participantId);
		statusMessage =
			participant.status === 'registered'
				? `Ready to start registered participant ${participant.participantId}.`
				: `Viewing participant ${participant.participantId}.`;
	}

	function handleClearParticipantSelection() {
		selectedRegisteredParticipantId = '';
		participantId = '';
		selectedParticipantDetail = null;
		statusMessage = '';
	}

	async function handleLocationOverride(patch: Partial<LocationOverride>, source = 'joystick') {
		if (!canUseWozControls) {
			statusMessage = activeControlMessage;
			return;
		}
		const nextActiveTriggerTags = activeTriggerTagsForLocation(patch);
		applyOptimisticLocationOverride(patch, nextActiveTriggerTags);
		await postJsonWithoutRefresh('/api/session/update', {
			locationOverride: patch,
			activeTriggerTags: nextActiveTriggerTags,
			eventType: 'wizard_location_override',
			payload: { ...patch, activeTriggerTags: nextActiveTriggerTags, source }
		});
	}

	function queueLiveLocationOverride(
		patch: Partial<LocationOverride>,
		activeTriggerTags: MapTriggerTag[]
	) {
		if (!canUseWozControls) return;
		applyOptimisticLocationOverride(patch, activeTriggerTags);
		broadcastLiveLocation(patch, activeTriggerTags);
		pendingLiveLocationOverride = {
			...pendingLiveLocationOverride,
			...patch
		};
		pendingLiveActiveTriggerTags = activeTriggerTags;
		const now = Date.now();
		const delay = Math.max(0, 16 - (now - lastLiveLocationSentAt));
		if (delay <= 0) {
			void flushLiveLocationOverride();
			return;
		}
		if (liveLocationTimer !== null) return;
		liveLocationTimer = window.setTimeout(() => {
			liveLocationTimer = null;
			void flushLiveLocationOverride();
		}, delay);
	}

	async function flushLiveLocationOverride() {
		if (!pendingLiveLocationOverride) return;
		const patch = pendingLiveLocationOverride;
		const activeTriggerTags = pendingLiveActiveTriggerTags;
		pendingLiveLocationOverride = null;
		pendingLiveActiveTriggerTags = undefined;
		lastLiveLocationSentAt = Date.now();
		await fetch('/api/session/live', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ locationOverride: patch, activeTriggerTags })
		}).catch(() => undefined);
	}

	function queueLoggedLocationOverride(
		patch: Partial<LocationOverride>,
		source: string,
		activeTriggerTags: MapTriggerTag[],
		force = false
	) {
		if (!canUseWozControls) return;
		pendingLoggedLocationOverride = {
			...pendingLoggedLocationOverride,
			...patch
		};
		pendingLoggedLocationSamples = [
			...pendingLoggedLocationSamples,
			{
				...patch,
				activeTriggerTags,
				source,
				clientTimestamp: new Date().toISOString()
			}
		].slice(-60);
		pendingLoggedActiveTriggerTags = activeTriggerTags;
		pendingLoggedLocationSource = source;
		const now = Date.now();
		if (force || now - lastLoggedLocationSentAt >= 450) {
			void flushLoggedLocationOverride();
			return;
		}
		if (loggedLocationTimer !== null) return;
		loggedLocationTimer = window.setTimeout(
			() => {
				loggedLocationTimer = null;
				void flushLoggedLocationOverride();
			},
			450 - (now - lastLoggedLocationSentAt)
		);
	}

	async function flushLoggedLocationOverride() {
		if (!pendingLoggedLocationOverride) return;
		const patch = pendingLoggedLocationOverride;
		const samples = pendingLoggedLocationSamples;
		const activeTriggerTags = pendingLoggedActiveTriggerTags;
		const source = pendingLoggedLocationSource;
		pendingLoggedLocationOverride = null;
		pendingLoggedLocationSamples = [];
		pendingLoggedActiveTriggerTags = undefined;
		lastLoggedLocationSentAt = Date.now();
		await postJsonWithoutRefresh('/api/session/update', {
			locationOverride: patch,
			activeTriggerTags,
			eventType: 'wizard_location_override',
			payload: {
				...patch,
				activeTriggerTags,
				source,
				sampled: true,
				sampleCount: samples.length,
				samples
			}
		}).catch((error) => {
			statusMessage = (error as Error).message;
		});
	}

	function applyRealtimeLocationOverride(
		patch: Partial<LocationOverride>,
		source: string,
		forceLog = false
	) {
		const activeTriggerTags = activeTriggerTagsForLocation(patch);
		queueLiveLocationOverride(patch, activeTriggerTags);
		queueLoggedLocationOverride(patch, source, activeTriggerTags, forceLog);
	}

	function clampPercent(value: number): number {
		return Math.max(0, Math.min(100, Math.round(value)));
	}

	function handleParticipantProgressChange(value: number, source = 'participant_slider_live') {
		participantProgressInput = clampPercent(value);
		void handleLocationOverride({ participantProgress: participantProgressInput / 100 }, source);
	}

	function handleParticipantProgressStep(delta: number, source = 'participant_keyboard') {
		handleParticipantProgressChange(participantProgressInput + delta, source);
	}

	function handleParticipantLocationKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			handleParticipantProgressStep(-5, 'participant_keyboard_left');
		}
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			handleParticipantProgressStep(5, 'participant_keyboard_right');
		}
	}

	function applyJoystickVector(dx: number, dy: number, source: string, movementScale = 1) {
		if (!activeMap) return;
		const distance = Math.hypot(dx, dy);
		const maxRadius = 84;
		const visualScale = distance > maxRadius ? maxRadius / distance : 1;
		joystickDx = dx * visualScale;
		joystickDy = dy * visualScale;

		if (distance < 18) {
			joystickLevel = 0;
			applyRealtimeLocationOverride(
				{
					participantControlLevel: 0,
					participantSpeed: participantSpeedInput
				},
				source
			);
			return;
		}

		const direction = directionDegreesFromVector(dx, dy);
		participantDirectionInput = direction;

		if (distance < 56) {
			joystickLevel = 1;
			applyRealtimeLocationOverride(
				{
					participantDirectionDegrees: direction,
					participantSpeed: participantSpeedInput,
					participantControlLevel: 1
				},
				source
			);
			return;
		}

		joystickLevel = 2;
		const currentPoint =
			typeof session?.locationOverride?.participantX === 'number' &&
			typeof session.locationOverride.participantY === 'number'
				? currentParticipantPoint()
				: { x: participantXInput, y: participantYInput };
		const unitX = dx / distance;
		const unitY = dy / distance;
		const movementStep = participantSpeedInput * movementScale;
		const nextX = clampNumber(currentPoint.x + unitX * movementStep, 0, activeMap.width);
		const nextY = clampNumber(currentPoint.y + unitY * movementStep, 0, activeMap.height);
		participantXInput = Number(nextX.toFixed(1));
		participantYInput = Number(nextY.toFixed(1));
		applyRealtimeLocationOverride(
			{
				participantX: participantXInput,
				participantY: participantYInput,
				participantDirectionDegrees: direction,
				participantSpeed: participantSpeedInput,
				participantControlLevel: 2
			},
			source
		);
	}

	function startJoystickLoop() {
		if (joystickAnimationFrame !== null) return;
		lastJoystickFrameAt = performance.now();
		const handleJoystickFrame = (timestamp: number) => {
			const vector = heldJoystickVector;
			if (!vector || joystickPointerId === null) {
				joystickAnimationFrame = null;
				return;
			}
			const elapsedMs = Math.max(16, Math.min(160, timestamp - lastJoystickFrameAt || 16));
			lastJoystickFrameAt = timestamp;
			applyJoystickVector(vector.dx, vector.dy, vector.source, elapsedMs / 100);
			joystickAnimationFrame = window.requestAnimationFrame(handleJoystickFrame);
		};
		joystickAnimationFrame = window.requestAnimationFrame(handleJoystickFrame);
	}

	function updateHeldJoystickVector(dx: number, dy: number, source: string) {
		heldJoystickVector = { dx, dy, source };
		const distance = Math.hypot(dx, dy);
		const maxRadius = 84;
		const visualScale = distance > maxRadius ? maxRadius / distance : 1;
		joystickDx = dx * visualScale;
		joystickDy = dy * visualScale;
		if (distance >= 18) {
			participantDirectionInput = directionDegreesFromVector(dx, dy);
			joystickLevel = distance < 56 ? 1 : 2;
		} else {
			joystickLevel = 0;
		}
		startJoystickLoop();
	}

	function stopJoystickLoop() {
		if (joystickAnimationFrame !== null) {
			window.cancelAnimationFrame(joystickAnimationFrame);
			joystickAnimationFrame = null;
		}
		heldJoystickVector = null;
		lastJoystickFrameAt = 0;
	}

	function handleJoystickPointerDown(event: PointerEvent) {
		if (!canUseWozControls) {
			statusMessage = activeControlMessage;
			return;
		}
		joystickPointerId = event.pointerId;
		(event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
		handleJoystickPointerMove(event);
		const point = currentParticipantPoint();
		joystickHoldStartedAt = Date.now();
		joystickHoldStartPoint = {
			x: Number(point.x.toFixed(1)),
			y: Number(point.y.toFixed(1)),
			direction: participantDirectionInput,
			speed: participantSpeedInput
		};
		postDashboardEvent('participant_joystick_start', {
			source: 'participant_joystick',
			participantX: joystickHoldStartPoint.x,
			participantY: joystickHoldStartPoint.y,
			participantDirectionDegrees: joystickHoldStartPoint.direction,
			participantSpeed: joystickHoldStartPoint.speed,
			participantControlLevel: joystickLevel,
			activeTriggerTags
		});
	}

	function handleJoystickPointerMove(event: PointerEvent) {
		if (joystickPointerId !== event.pointerId) return;
		const bounds = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
		const dx = event.clientX - (bounds.left + bounds.width / 2);
		const dy = event.clientY - (bounds.top + bounds.height / 2);
		updateHeldJoystickVector(dx, dy, 'participant_joystick');
	}

	function handleJoystickPointerEnd(event: PointerEvent) {
		if (joystickPointerId !== event.pointerId) return;
		if ((event.currentTarget as HTMLDivElement).hasPointerCapture(event.pointerId)) {
			(event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
		}
		const endedAt = Date.now();
		const durationMs = joystickHoldStartedAt > 0 ? endedAt - joystickHoldStartedAt : 0;
		const endPoint = currentParticipantPoint();
		const startPoint = joystickHoldStartPoint;
		const endControlLevel = joystickLevel;
		joystickPointerId = null;
		stopJoystickLoop();
		joystickLevel = 0;
		joystickDx = 0;
		joystickDy = 0;
		applyRealtimeLocationOverride(
			{
				participantControlLevel: 0,
				participantSpeed: participantSpeedInput
			},
			'participant_joystick_hold',
			true
		);
		postDashboardEvent('participant_joystick_end', {
			source: 'participant_joystick',
			durationMs,
			durationSeconds: Math.round(durationMs / 100) / 10,
			startParticipantX: startPoint?.x,
			startParticipantY: startPoint?.y,
			startParticipantDirectionDegrees: startPoint?.direction,
			endParticipantX: Number(endPoint.x.toFixed(1)),
			endParticipantY: Number(endPoint.y.toFixed(1)),
			endParticipantDirectionDegrees: participantDirectionInput,
			participantSpeed: participantSpeedInput,
			participantControlLevel: endControlLevel,
			activeTriggerTags
		});
		joystickHoldStartedAt = 0;
		joystickHoldStartPoint = null;
	}

	function handleParticipantSpeedChange(value: number) {
		participantSpeedInput = clampNumber(Math.round(value), 2, 30);
		applyRealtimeLocationOverride(
			{
				participantSpeed: participantSpeedInput,
				participantControlLevel: joystickLevel
			},
			'participant_speed_control'
		);
	}

	function syncLocationInputs() {
		participantProgressInput = participantLocationPercent;
		const point = currentParticipantPoint();
		participantXInput = Number(point.x.toFixed(1));
		participantYInput = Number(point.y.toFixed(1));
		participantDirectionInput = normalizeDegrees(
			session?.locationOverride?.participantDirectionDegrees ?? participantDirectionInput
		);
		participantSpeedInput = clampNumber(
			session?.locationOverride?.participantSpeed ?? participantSpeedInput,
			2,
			30
		);
	}

	async function handleReviseEta() {
		if (!canRevisePickupTiming) {
			statusMessage = activeControlMessage;
			return;
		}
		const nextArrival = Math.max(30, Number(revisedEtaSeconds));
		const activeDelay = session?.scenario.timings.delay ?? delayAt;
		const nextRevisedPickupEta = session?.scenario.includeDelay
			? Math.max(30, nextArrival - activeDelay)
			: nextArrival;
		const nextNearArrival = nextArrival;
		if (
			!confirmAction(
				`Revise the active block handoff timing to ${nextArrival} seconds from block start?`
			)
		)
			return;
		await handleUpdate({
			scenario: {
				durationSeconds: nextArrival,
				initialEtaSeconds:
					session?.scenario.initialEtaSeconds ??
					(session?.scenario.includeDelay ? Math.max(30, arrivalAt - delayAt) : arrivalAt),
				revisedEtaSeconds: nextRevisedPickupEta,
				timings: {
					...(session?.scenario.timings ?? {
						delay: delayAt,
						near_arrival: nearArrivalAt,
						arrival: arrivalAt
					}),
					near_arrival: nextNearArrival,
					arrival: nextArrival
				}
			},
			eventType: 'manual_revise_eta',
			payload: {
				revisedEtaSeconds: nextRevisedPickupEta,
				near_arrival: nextNearArrival,
				blockEnd: nextArrival
			}
		});
	}

	async function handleMarkNote() {
		const note = researcherNote.trim();
		if (!note) return;
		const timestamp = new Date().toLocaleTimeString();
		const nextNotes = `${session?.notes ? `${session.notes}\n` : ''}[${timestamp}] ${note}`;
		await handleUpdate({
			notes: nextNotes,
			eventType: 'researcher_note_marked',
			payload: { note }
		});
		researcherNote = '';
	}

	async function handleTechnicalIssue() {
		if (!technicalIssue.trim()) return;
		if (!confirmAction('Mark this technical issue on the participant record?')) return;
		await handleUpdate({
			technicalIssue,
			eventType: 'technical_issue_marked',
			payload: { technicalIssue }
		});
		technicalIssue = '';
	}

	function handleSelectEditMap(mapId: string) {
		const map = maps.find((item: StudyMap) => item.id === mapId);
		if (map) {
			editMap = cloneMap(map);
			selectedMapObjectId = editMap.objects[0]?.id ?? '';
			selectedViewportKey = editMap.initialViewport ?? 'default';
		}
	}

	function addMapObject() {
		if (!editMap) return;
		const object: StudyMapObject = {
			id: `${newObjectType}-${Date.now().toString(36)}`,
			type: newObjectType,
			label: newObjectType.replaceAll('_', ' '),
			x: 80,
			y: 80,
			x2: isLineType(newObjectType) ? 220 : undefined,
			y2: isLineType(newObjectType) ? 140 : undefined,
			width: newObjectType === 'zone' || newObjectType === 'obstacle' ? 92 : undefined,
			height: newObjectType === 'zone' || newObjectType === 'obstacle' ? 56 : undefined,
			size: getObjectSize(newObjectType),
			zIndex: defaultZIndex(newObjectType)
		};
		editMap = { ...editMap, objects: [...editMap.objects, object] };
		selectedMapObjectId = object.id;
	}

	function removeMapObject(id: string) {
		if (!editMap) return;
		if (!confirmAction('Remove this map object from the editable map?')) return;
		editMap = {
			...editMap,
			objects: editMap.objects.filter((object: StudyMapObject) => object.id !== id)
		};
		if (selectedMapObjectId === id) selectedMapObjectId = editMap.objects[0]?.id ?? '';
	}

	async function saveEditMap() {
		if (!editMap) return;
		const mapToSave = normalizeEditMap(editMap);
		if (
			maps.some((map) => map.id === mapToSave.id) &&
			!confirmAction(`Save changes to "${mapToSave.name}"?`)
		)
			return;
		await postJson('/api/maps', mapToSave);
		statusMessage = 'Map saved locally.';
	}

	function handleNewMap() {
		const map = blankMap();
		editMap = map;
		selectedMapObjectId = '';
		statusMessage = 'New unsaved map created. Add objects and save it locally.';
	}

	async function handleDuplicateMap() {
		if (!editMap) return;
		const timestamp = new Date().toISOString();
		const duplicate: StudyMap = {
			...cloneMap(editMap),
			id: `${editMap.id}-copy-${Date.now().toString(36)}`,
			name: `${editMap.name} Copy`,
			createdAt: timestamp,
			updatedAt: timestamp
		};
		editMap = duplicate;
		selectedMapObjectId = duplicate.objects[0]?.id ?? '';
		await postJson('/api/maps', duplicate);
		statusMessage = 'Map duplicated locally.';
	}

	async function handleDeleteEditMap() {
		if (!editMap) return;
		if (
			!confirmAction(
				`Delete "${editMap.name}" from local map storage? This cannot be undone from the dashboard.`
			)
		)
			return;
		const deletedMapId = editMap.id;
		if (session?.mapLocked && session.selectedMapId === editMap.id) {
			statusMessage = 'The active session map is locked and cannot be deleted.';
			return;
		}
		try {
			await deleteJson(`/api/maps/${editMap.id}`);
			statusMessage = 'Map deleted locally.';
			const remaining = dashboardState.maps.filter((map) => map.id !== deletedMapId);
			const nextMap = remaining[0] ?? dashboardState.maps[0];
			editMap = nextMap ? cloneMap(nextMap) : blankMap();
			selectedMapObjectId = editMap.objects[0]?.id ?? '';
			if (selectedMapId === deletedMapId && nextMap) selectedMapId = nextMap.id;
		} catch (error) {
			statusMessage = (error as Error).message;
		}
	}

	$effect(() => {
		if (!browser) return;
		void refresh();
		const refreshInterval = window.setInterval(() => void refresh(), 1500);
		const timerInterval = window.setInterval(() => {
			dashboardNow = Date.now();
		}, 1000);
		return () => {
			window.clearInterval(refreshInterval);
			window.clearInterval(timerInterval);
			if (liveLocationTimer !== null) window.clearTimeout(liveLocationTimer);
			if (loggedLocationTimer !== null) window.clearTimeout(loggedLocationTimer);
			stopJoystickLoop();
			liveLocationChannel?.close();
			liveLocationChannel = null;
		};
	});

	$effect(() => {
		if (!session) return;
		syncLocationInputs();
	});

	$effect(() => {
		if (!selectedMapId && maps[0]) selectedMapId = maps[0].id;
	});

	$effect(() => {
		if (!studySetupLocked || !lockedStudyScenario) return;
		applyScenarioToSetup(lockedStudyScenario);
	});
</script>

<svelte:head>
	<title>VERDĒ Research Dashboard</title>
</svelte:head>

<main class="min-h-dvh bg-canvas-mist px-6 py-6 text-forest">
	<header class="flex w-full flex-wrap items-center justify-between gap-4">
		<div>
			<p class="text-[0.72rem] font-bold tracking-[0.32em]">V E R D Ē</p>
			<h1 class="mt-2 text-3xl font-bold">Research dashboard</h1>
		</div>
		<div class="flex flex-wrap gap-2">
			<button
				class="rounded-full border border-[var(--hairline)] bg-white px-4 py-2 text-sm font-bold"
				onclick={handleOpenStudySetup}>Study setup</button
			>
			<button
				class="rounded-full bg-leaf px-4 py-2 text-sm font-bold text-white"
				onclick={handleOpenAddParticipant}>Add participant</button
			>
			<button
				class="rounded-full border border-[var(--hairline)] bg-white px-4 py-2 text-sm font-bold"
				onclick={handleOpenMapBuilder}>Map builder</button
			>
			<a
				class="rounded-full border border-[var(--hairline)] bg-white px-4 py-2 text-sm font-bold"
				href="/app"
				target="_blank">Open app</a
			>
			<a
				class="rounded-full bg-forest px-4 py-2 text-sm font-bold text-white"
				href="/api/state"
				target="_blank">State JSON</a
			>
		</div>
	</header>

	<div
		class="mt-6 grid w-full min-w-0 items-start gap-5 xl:grid-cols-[minmax(300px,1fr)_minmax(0,3fr)]"
	>
		<section class="grid min-w-0 content-start gap-5 xl:col-start-1">
			{#if hasActiveDashboardSession}
				<article class="verde-card p-5">
					<h2 class="text-xl font-bold">Researcher notes</h2>
					<div
						class="mt-3 min-h-28 rounded-2xl border border-[var(--hairline)] bg-white p-4 text-sm leading-6 whitespace-pre-wrap text-[#263C34]"
					>
						{session?.notes || 'No researcher notes marked yet.'}
					</div>
					<div class="mt-3 grid gap-2">
						<textarea
							class="min-h-24 w-full rounded-2xl border border-[var(--hairline)] p-4"
							bind:value={researcherNote}
							placeholder="Write a new researcher note..."
						></textarea>
						<button
							class="rounded-full bg-forest px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
							disabled={!researcherNote.trim() || !session}
							onclick={handleMarkNote}
						>
							Mark note
						</button>
					</div>
					<div class="mt-3 flex gap-2">
						<input
							class="flex-1 rounded-full border border-[var(--hairline)] px-4 py-3"
							bind:value={technicalIssue}
							placeholder="Technical issue note"
						/>
						<button
							class="rounded-full bg-attention px-4 py-3 text-sm font-bold text-white"
							onclick={handleTechnicalIssue}>Mark issue</button
						>
					</div>
				</article>
			{/if}
			{#if hasActiveDashboardSession}
				<article class="verde-card p-5">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h2 class="text-xl font-bold">Automatic AIC triggers</h2>
							<p class="mt-1 text-sm leading-5 text-corduroy">
								Read-only guidance. Tags activate automatically from participant location, shuttle
								timing, and configured map zones.
							</p>
						</div>
						<span
							class="rounded-full border border-[var(--hairline)] bg-white px-3 py-2 text-xs font-bold text-forest"
						>
							{activeTriggerTags.length} active
						</span>
					</div>
					<div class="mt-3 grid gap-2">
						{#each mapTriggerTags as trigger}
							<div
								class="rounded-2xl border px-3 py-2 text-left text-xs font-bold"
								class:border-leaf={activeTriggerTags.includes(trigger.tag)}
								class:bg-mint={activeTriggerTags.includes(trigger.tag)}
								class:border-[var(--hairline)]={!activeTriggerTags.includes(trigger.tag)}
								title={trigger.description}
							>
								<span class="flex items-center justify-between gap-3 text-forest">
									<span class="flex items-center gap-2">
										<span aria-hidden="true">{triggerEmoji(trigger.tag)}</span>
									<span>{trigger.label}</span>
									</span>
									<span class="rounded-full bg-white px-2 py-0.5 text-[0.65rem] text-corduroy">
										{activeTriggerTags.includes(trigger.tag) ? 'active' : 'idle'}
									</span>
								</span>
								<span class="block pt-1 font-medium text-corduroy">{trigger.description}</span>
							</div>
						{/each}
					</div>
				</article>
			{/if}
			<article class="verde-card p-5">
				{#if hasActiveDashboardSession}
					<h2 class="text-xl font-bold">Event log</h2>
					<div class="mt-4 grid max-h-[560px] gap-2 overflow-auto">
						{#each latestEvents as event (event.id)}
							<div class="rounded-2xl border border-[var(--hairline)] bg-white p-3 text-xs">
								<div class="flex justify-between gap-3 font-bold">
									<span class="flex items-center gap-2">
										<span aria-hidden="true">{eventEmoji(event.type)}</span>
									<span>{event.type}</span>
									</span>
									<span>{new Date(event.timestamp).toLocaleTimeString()}</span>
								</div>
								<p class="mt-1 text-corduroy">{event.source} · {event.phase ?? 'no phase'}</p>
							</div>
						{:else}
							<p class="text-sm text-corduroy">No events yet.</p>
						{/each}
					</div>
				{:else}
					<h2 class="text-xl font-bold">Session launch</h2>
					<div class="mt-4 grid gap-3">
						<div class="rounded-2xl border border-[var(--hairline)] bg-white p-4">
							<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">Study setup</p>
							<p class="mt-2 text-sm font-bold text-forest">{studySetupStatus}</p>
							<p class="mt-1 text-xs leading-5 font-semibold text-corduroy">
								Current script: {timingSummary}
							</p>
							<button
								class="mt-3 rounded-full border border-[var(--hairline)] bg-white px-4 py-2 text-sm font-bold"
								onclick={handleOpenStudySetup}
							>
								{studySetupLocked ? 'View study setup' : 'Configure study setup'}
							</button>
						</div>
						{#if selectedParticipantRecord}
							<div class="rounded-2xl border border-leaf bg-mint p-4">
								<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">
									Selected participant
								</p>
								<h3 class="mt-2 text-xl font-bold text-forest">
									{selectedParticipantRecord.participantId}
								</h3>
								<p class="mt-1 text-sm font-semibold text-corduroy">
									{conditionOrderLabel(selectedParticipantRecord.conditionOrder)}
								</p>
								<p class="mt-1 text-sm font-semibold text-corduroy">
									Map: {mapNameForId(selectedParticipantRecord.selectedMapId)}
								</p>
								<p class="mt-1 text-sm font-semibold text-corduroy">
									Status: {selectedParticipantRecord.status.replace('_', ' ')} · {selectedParticipantRecord.completedBlocks}/{selectedParticipantRecord.totalBlocks}
									blocks
								</p>
							</div>
						{:else}
							<p
								class="rounded-2xl border border-[var(--hairline)] bg-white px-4 py-3 text-sm leading-6 font-semibold text-corduroy"
							>
								Waiting for a participant. Select a participant from the records list, or add a new
								participant.
							</p>
						{/if}
						<div class="grid gap-2">
							<button
								class="verde-focus rounded-full bg-forest px-5 py-3 font-bold text-white disabled:opacity-40"
								disabled={!participantId || !canStartParticipantSession}
								onclick={handleStartSession}
							>
								{participantIsRegistered
									? canStartParticipantSession
										? 'Start registered participant'
										: 'Finish active session first'
									: selectedParticipantRecord
										? 'Record selected for viewing'
										: 'Select a registered participant'}
							</button>
							{#if selectedParticipantRecord}
								<button
									class="rounded-full border border-[var(--hairline)] bg-white px-5 py-3 text-sm font-bold text-corduroy"
									onclick={handleClearParticipantSelection}
								>
									Clear selected record
								</button>
							{/if}
						</div>
						{#if statusMessage}<p class="rounded-2xl bg-mint px-4 py-3 text-sm font-bold">
								{statusMessage}
							</p>{/if}
					</div>
				{/if}
			</article>

			<article class="verde-card p-5">
				<div class="flex items-start justify-between gap-3">
					<div>
						<h2 class="text-xl font-bold">Participant records</h2>
						<p class="mt-1 text-sm text-corduroy">
							Saved JSON exports in local participant storage.
						</p>
					</div>
					<div class="flex flex-wrap justify-end gap-2">
						<button
							class="rounded-full bg-leaf px-4 py-2 text-sm font-bold text-white"
							onclick={handleOpenAddParticipant}>Add participant</button
						>
						<span
							class="rounded-full border border-[var(--hairline)] bg-white px-4 py-2 text-sm font-bold text-forest"
						>
							{participantSummaries.length}
						</span>
					</div>
				</div>
				<div class="mt-4 grid max-h-[420px] gap-2 overflow-auto">
					{#each participantSummaries as participant (participant.participantId)}
						<div class="rounded-2xl border border-[var(--hairline)] bg-white p-3 text-xs">
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="text-sm font-bold text-forest">{participant.participantId}</p>
									<p class="mt-1 font-semibold text-corduroy">
										{conditionOrderLabel(participant.conditionOrder)}
									</p>
									<p class="mt-1 font-semibold text-corduroy">
										Map: {mapNameForId(participant.selectedMapId)}
									</p>
								</div>
								<div class="grid justify-items-end gap-2">
									<span
										class="rounded-full px-3 py-1 font-bold"
										class:bg-leaf={participant.status === 'registered'}
										class:bg-mint={participant.status === 'completed'}
										class:bg-white={participant.status === 'in_progress'}
										class:text-white={participant.status === 'registered'}
										class:text-forest={participant.status === 'completed'}
										class:text-corduroy={participant.status === 'in_progress'}
									>
										{participant.status === 'registered'
											? 'registered'
											: `${participant.completedBlocks}/${participant.totalBlocks}`}
									</span>
									<button
										class="rounded-full border border-[var(--hairline)] bg-white px-3 py-1 font-bold text-forest disabled:opacity-40"
										onclick={() => handleUseParticipant(participant)}
									>
										{participant.status === 'registered' ? 'Select' : 'View'}
									</button>
									<button
										class="rounded-full border border-leaf bg-white px-3 py-1 font-bold text-forest disabled:opacity-40"
										disabled={participant.status !== 'registered'}
										onclick={() => handleOpenEditParticipant(participant)}
									>
										Edit
									</button>
									<button
										class="rounded-full border border-critical bg-white px-3 py-1 font-bold text-critical disabled:opacity-40"
										disabled={participant.status !== 'registered'}
										onclick={() => handleDeleteRegisteredParticipant(participant)}
									>
										Remove
									</button>
								</div>
							</div>
							<p class="mt-2 text-corduroy">
								Updated {new Date(participant.updatedAt).toLocaleString()} · {participant.status.replace(
									'_',
									' '
								)}
							</p>
						</div>
					{:else}
						<p class="rounded-2xl bg-white px-4 py-3 text-sm text-corduroy">
							No participant JSON records yet.
						</p>
					{/each}
				</div>
			</article>
		</section>

		<section
			class="grid min-w-0 gap-5 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:grid-cols-2 xl:items-start"
		>
			<article class="verde-card p-5 xl:col-span-2">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 class="text-xl font-bold">Active state</h2>
						{#if hasActiveDashboardSession && session}
							<p class="mt-1 text-sm text-corduroy">
								Participant {session.participantId} · Block {session.activeBlock}
							</p>
						{:else}
							<p class="mt-1 text-sm text-corduroy">Waiting for a participant.</p>
						{/if}
					</div>
					{#if hasActiveDashboardSession && session}
						<span class="rounded-full border px-4 py-2 text-sm font-bold {statusChipClass()}"
							>{session.status}</span
						>
					{/if}
				</div>

				{#if hasActiveDashboardSession && session}
					<div class="mt-5 grid gap-3 md:grid-cols-3">
						<div class="rounded-3xl border border-[var(--hairline)] bg-white p-4">
							<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">Condition</p>
							<div
								class="mt-3 inline-flex rounded-full border px-4 py-2 text-sm font-bold {conditionChipClass()}"
							>
								{conditionLabel(session.activeCondition)}
							</div>
						</div>
						<div class="rounded-3xl border border-[var(--hairline)] bg-white p-4">
							<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">
								Current phase
							</p>
							<div
								class="mt-3 inline-flex rounded-full border px-4 py-2 text-sm font-bold {phaseChipClass()}"
							>
								{phaseLabel(session.phase)}
							</div>
						</div>
						<div class="rounded-3xl border border-[var(--hairline-strong)] bg-mint p-4">
							<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">
								Elapsed time
							</p>
							<p class="mt-2 text-4xl font-bold text-forest tabular-nums">
								{formatSeconds(elapsedSeconds)}
							</p>
							<p class="mt-1 text-xs font-semibold text-corduroy">
								of {formatSeconds(session.scenario.durationSeconds)}
							</p>
						</div>
					</div>

					<div class="mt-4 rounded-3xl border border-[var(--hairline)] bg-white p-4">
						<div class="flex items-center justify-between gap-3 text-xs font-bold text-corduroy">
							<span>Block progress</span>
							<span>{elapsedPercent}%</span>
						</div>
						<div class="mt-3 h-3 overflow-hidden rounded-full bg-mint">
							<div
								class="h-full rounded-full bg-leaf transition-all duration-500"
								style={`width: ${elapsedPercent}%`}
							></div>
						</div>
						<div class="mt-3 grid gap-2 text-xs font-semibold text-corduroy sm:grid-cols-3">
							<span
								>Delay: {session.scenario.includeDelay
									? formatSeconds(session.scenario.timings.delay)
									: 'off'}</span
							>
							<span
								>Near-arrival handoff: {formatSeconds(session.scenario.timings.near_arrival)}</span
							>
							<span>Block end: {formatSeconds(session.scenario.timings.arrival)}</span>
							<span>Selection: {formatSeconds(session.scenario.selectionCountdownSeconds)}</span>
							<span>Assignment: {formatSeconds(session.scenario.assignmentDurationSeconds)}</span>
							<span
								>Handoff buffer: {formatSeconds(
									session.scenario.arrivalCompletionBufferSeconds
								)}</span
							>
						</div>
					</div>

					<div class="mt-4 rounded-3xl border border-[var(--hairline-strong)] bg-white p-4">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">
									Participant ride request
								</p>
								<h3 class="mt-2 text-xl font-bold text-forest">
									{selectedRideOption?.label ?? 'No shuttle option selected yet'}
								</h3>
								<p class="mt-1 text-sm font-semibold text-corduroy">
									{selectedRideOption?.pickupPoint ?? 'Waiting for participant planning action'}
								</p>
							</div>
							<span
								class="rounded-full border border-[var(--hairline)] bg-mint px-4 py-2 text-sm font-bold text-forest"
							>
								{activeBlockState?.rideRequestStatus ?? 'none'}
							</span>
						</div>
						{#if selectedRideOption}
							<div class="mt-4 grid gap-2 text-sm font-semibold text-[#263C34] md:grid-cols-4">
								<span>Wait {rideOptionWaitMinutes(selectedRideOption)} min</span>
								<span>Walk {selectedRideOption.walkMinutes} min</span>
								<span>Ride {selectedRideOption.rideMinutes} min</span>
								<span>{selectedRideOption.vehicleId}</span>
							</div>
						{/if}
					</div>

					<div
						class="mt-4 rounded-3xl border px-4 py-3 text-sm font-bold"
						class:border-attention={activeBlockCompleted && !allBlocksCompleted}
						class:bg-attention={activeBlockCompleted && !allBlocksCompleted}
						class:text-white={activeBlockCompleted && !allBlocksCompleted}
						class:border-leaf={activeBlockCompleted && allBlocksCompleted}
						class:bg-mint={activeBlockCompleted && allBlocksCompleted}
						class:text-forest={activeBlockCompleted && allBlocksCompleted}
						class:border-[var(--hairline)]={!activeBlockCompleted}
						class:bg-white={!activeBlockCompleted}
						class:text-corduroy={!activeBlockCompleted}
					>
						{activeControlMessage}
					</div>

					<div class="mt-5 grid gap-3 md:grid-cols-4">
						{#if session.status === 'ready' || session.status === 'idle'}
							<div
								class="rounded-full border border-[var(--hairline)] bg-white px-4 py-3 text-center text-sm font-bold text-corduroy"
							>
								Waiting for ride request
							</div>
						{:else if session.status === 'running'}
							<button
								class="rounded-full border border-[var(--hairline)] bg-white px-4 py-3 text-sm font-bold disabled:opacity-40"
								disabled={!canPauseSession}
								onclick={() => handleAutomation('pause')}>Pause</button
							>
						{:else if session.status === 'paused'}
							<button
								class="rounded-full bg-leaf px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
								disabled={!canResumeSession}
								onclick={() => handleAutomation('resume')}>Resume</button
							>
						{:else}
							<div
								class="rounded-full border border-[var(--hairline)] bg-white px-4 py-3 text-center text-sm font-bold text-corduroy"
							>
								Block finished
							</div>
						{/if}
						<button
							class="rounded-full bg-forest px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
							disabled={!canFinishBlock}
							onclick={() => handleAutomation('finish')}
						>
							Finish block
						</button>
						<button
							class="rounded-full bg-leaf px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
							disabled={!canFinishStudy}
							onclick={() => handleAutomation('finish_study')}
						>
							Finish study
						</button>
					</div>
					<div class="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
						<div class="flex flex-wrap gap-2">
							{#each phases as phase}
								<button
									class="rounded-full border border-[var(--hairline)] bg-white px-3 py-2 text-xs font-bold disabled:opacity-40"
									disabled={!canJumpPhase || phase === session.phase}
									onclick={() => handleJumpPhase(phase)}
								>
									Jump: {phaseLabel(phase)}
								</button>
							{/each}
						</div>
						<div class="flex flex-wrap gap-2 lg:max-w-[360px] lg:justify-end">
							{#each sicBoardingSteps as item}
								<button
									class="rounded-full border px-3 py-2 text-xs font-bold disabled:opacity-40"
									class:border-forest={session.sicBoardingStep === item.step}
									class:bg-forest={session.sicBoardingStep === item.step}
									class:text-white={session.sicBoardingStep === item.step}
									class:border-[var(--hairline)]={session.sicBoardingStep !== item.step}
									class:bg-white={session.sicBoardingStep !== item.step}
									class:text-forest={session.sicBoardingStep !== item.step}
									disabled={!canUseSicBoardingControls || session.sicBoardingStep === item.step}
									onclick={() => handleSicBoardingStep(item.step)}
								>
									{item.step}. {item.label}
								</button>
							{/each}
							<button
								class="rounded-full border px-3 py-2 text-xs font-bold disabled:opacity-40"
								class:border-leaf={canShowBindingScreen}
								class:bg-leaf={canShowBindingScreen}
								class:text-white={canShowBindingScreen}
								class:border-[var(--hairline)]={!canShowBindingScreen}
								class:bg-white={!canShowBindingScreen}
								class:text-corduroy={!canShowBindingScreen}
								disabled={!canShowBindingScreen}
								onclick={handleShowBindingScreen}
							>
								Show binding
							</button>
						</div>
					</div>
					<div class="mt-5 grid gap-3 md:grid-cols-3">
						<label class="grid gap-1 text-sm font-bold">
							Handoff timing seconds
							<input
								class="rounded-2xl border border-[var(--hairline)] px-3 py-3 disabled:opacity-40"
								type="number"
								bind:value={revisedEtaSeconds}
								disabled={!canRevisePickupTiming}
							/>
						</label>
						<button
							class="mt-6 rounded-full bg-leaf px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
							disabled={!canRevisePickupTiming}
							onclick={handleReviseEta}>Revise handoff timing</button
						>
						<button
							class="mt-6 rounded-full border px-4 py-3 text-sm font-bold disabled:opacity-40"
							class:border-attention={canSwitchBlock}
							class:bg-attention={canSwitchBlock}
							class:text-white={canSwitchBlock}
							class:border-[var(--hairline)]={!canSwitchBlock}
							class:bg-white={!canSwitchBlock}
							disabled={!canSwitchBlock}
							onclick={handleSwitchBlock}
						>
							{canSwitchBlock ? `Switch to Block ${nextBlockState?.block}` : 'Switch block'}
						</button>
					</div>
				{:else}
					<div class="mt-5 rounded-3xl border border-[var(--hairline)] bg-white p-6">
						<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">Ready state</p>
						<h3 class="mt-2 text-2xl font-bold text-forest">Waiting for a participant</h3>
						<p class="mt-2 text-sm leading-6 text-corduroy">
							Select a registered participant from the records panel to start the next session.
							Completed or in-progress records can be selected for review only.
						</p>
						{#if selectedParticipantRecord}
							<div class="mt-4 rounded-2xl bg-mint px-4 py-3 text-sm font-semibold text-forest">
								Selected: {selectedParticipantRecord.participantId} · {selectedParticipantRecord.status.replace(
									'_',
									' '
								)} · Map {mapNameForId(selectedParticipantRecord.selectedMapId)}
							</div>
						{/if}
					</div>
					{#if selectedParticipantDetail}
						<div class="mt-5 grid gap-4">
							<div class="rounded-3xl border border-[var(--hairline)] bg-white p-5">
								<div class="flex flex-wrap items-start justify-between gap-3">
									<div>
										<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">
											Selected record
										</p>
										<h3 class="mt-2 text-2xl font-bold text-forest">
											{selectedParticipantDetail.participantId}
										</h3>
										<p class="mt-1 text-sm font-semibold text-corduroy">
											{conditionOrderLabel(selectedParticipantDetail.conditionOrder)} · Map {mapNameForId(
												selectedParticipantDetail.selectedMapId
											)}
										</p>
									</div>
									<span
										class="rounded-full border border-[var(--hairline)] bg-mint px-4 py-2 text-sm font-bold text-forest"
									>
										{selectedParticipantDetail.registrationStatus ?? 'registered'}
									</span>
								</div>
								<div class="mt-4 grid gap-2 text-sm font-semibold text-corduroy sm:grid-cols-3">
									<span
										>Created {new Date(selectedParticipantDetail.createdAt).toLocaleString()}</span
									>
									<span
										>Updated {new Date(selectedParticipantDetail.updatedAt).toLocaleString()}</span
									>
									<span>{selectedParticipantDetail.events.length} total events</span>
								</div>
							</div>

							<div class="grid gap-4 xl:grid-cols-2">
								{#each selectedParticipantDetail.blocks as block (block.block)}
									<div class="rounded-3xl border border-[var(--hairline)] bg-white p-5">
										<div class="flex items-start justify-between gap-3">
											<div>
												<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">
													Block {block.block}
												</p>
												<h4 class="mt-2 text-xl font-bold text-forest">
													{conditionLabel(block.condition)}
												</h4>
											</div>
											<span
												class="rounded-full bg-canvas-mist px-3 py-1 text-xs font-bold text-forest"
											>
												{block.completedAt ? 'completed' : 'not completed'}
											</span>
										</div>
										<div class="mt-4 grid gap-2 text-xs font-semibold text-corduroy">
											<span>Ride status: {block.rideRequestStatus}</span>
											<span>Selected option: {block.selectedRideOptionId ?? 'none'}</span>
											<span
												>Started: {block.startedAt
													? new Date(block.startedAt).toLocaleString()
													: 'not started'}</span
											>
											<span
												>Completed: {block.completedAt
													? new Date(block.completedAt).toLocaleString()
													: 'not completed'}</span
											>
										</div>
										<div class="mt-4 grid max-h-72 gap-3 overflow-auto">
											{#each block.events.slice().reverse() as event (event.id)}
												<div
													class="rounded-2xl border border-[var(--hairline)] bg-canvas-mist p-3 text-xs"
												>
													<div
														class="flex flex-wrap items-start justify-between gap-2 font-bold text-forest"
													>
														<span class="flex items-center gap-2">
															<span aria-hidden="true">{eventEmoji(event.type)}</span>
														<span>{event.type}</span>
														</span>
														<span>{new Date(event.timestamp).toLocaleTimeString()}</span>
													</div>
													<p class="mt-1 font-semibold text-corduroy">
														{event.source} · {event.phase ?? 'no phase'}
													</p>
													{#if event.payload}
														<pre
															class="mt-2 overflow-auto rounded-xl bg-white p-2 text-[0.68rem] leading-4 text-corduroy">{JSON.stringify(
																event.payload,
																null,
																2
															)}</pre>
													{/if}
												</div>
											{:else}
												<p class="rounded-2xl bg-canvas-mist px-4 py-3 text-sm text-corduroy">
													No block events.
												</p>
											{/each}
										</div>
									</div>
								{/each}
							</div>

							<div class="rounded-3xl border border-[var(--hairline)] bg-white p-5">
								<p class="text-xs font-bold tracking-[0.18em] text-corduroy uppercase">
									Participant event timeline
								</p>
								<div class="mt-4 grid max-h-[520px] gap-3 overflow-auto">
									{#each selectedParticipantEvents as event (event.id)}
										<div
											class="rounded-2xl border border-[var(--hairline)] bg-canvas-mist p-4 text-xs"
										>
											<div class="flex flex-wrap items-start justify-between gap-3">
												<div>
													<h4 class="flex items-center gap-2 text-sm font-bold text-forest">
														<span aria-hidden="true">{eventEmoji(event.type)}</span>
														<span>{event.type}</span>
													</h4>
													<p class="mt-1 font-semibold text-corduroy">
														{event.source} · Block {event.block ?? 'n/a'} · {event.condition
															? conditionLabel(event.condition)
															: 'no condition'} · {event.phase ?? 'no phase'}
													</p>
												</div>
												<span class="font-bold text-corduroy"
													>{new Date(event.timestamp).toLocaleString()}</span
												>
											</div>
											{#if event.payload}
												<pre
													class="mt-3 overflow-auto rounded-xl bg-white p-3 text-[0.7rem] leading-4 text-corduroy">{JSON.stringify(
														event.payload,
														null,
														2
													)}</pre>
											{/if}
										</div>
									{:else}
										<p class="rounded-2xl bg-canvas-mist px-4 py-3 text-sm text-corduroy">
											No participant events stored.
										</p>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				{/if}
			</article>

			{#if hasActiveDashboardSession}
				<article class="verde-card order-2 h-full p-5 xl:col-span-1">
					<h2 class="text-xl font-bold">Active map</h2>
					<div class="mt-4">
						<RouteMap
							map={activeMap}
							phase={session?.phase ?? 'booking'}
							adaptive={session?.activeCondition === 'aic'}
							selectedPickup={selectedRideOption?.pickupPoint}
							showLabels={false}
							showAllPickups={!selectedRideOption}
							participantProgress={participantProgressInput / 100}
							participantX={session?.locationOverride?.participantX}
							participantY={session?.locationOverride?.participantY}
							participantDirectionDegrees={session?.locationOverride?.participantDirectionDegrees}
							shuttleProgress={timedShuttleProgress}
							{activeTriggerTags}
							motionEnabled={false}
							viewportMode={activeMap?.initialViewport ?? 'default'}
						/>
					</div>
				</article>
			{/if}

			{#if hasActiveDashboardSession}
				<article class="verde-card order-3 p-5 xl:col-span-1">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h2 class="text-xl font-bold">Wizard-of-Oz location</h2>
							<!-- <p class="mt-1 text-sm leading-6 text-corduroy">
								Manually move only the participant marker if the participant is early, late, or does
								not physically move in time. Shuttle progress follows the configured block timing.
							</p> -->
						</div>
						<!-- <span
							class="rounded-full border border-[var(--hairline)] bg-mint px-4 py-2 text-sm font-bold text-forest"
						>
							Participant control
						</span> -->
					</div>
					<div class="mt-4 grid gap-4">
						<div
							class="rounded-2xl border px-4 py-3 text-sm font-bold"
							class:border-attention={activeTriggerTags.includes('participant_wrong_way')}
							class:bg-[#FFF3E5]={activeTriggerTags.includes('participant_wrong_way')}
							class:text-forest={activeTriggerTags.includes('participant_wrong_way')}
							class:border-[var(--hairline)]={!activeTriggerTags.includes('participant_wrong_way')}
							class:bg-white={!activeTriggerTags.includes('participant_wrong_way')}
						>
							Wrong-way cue:
							{activeTriggerTags.includes('participant_wrong_way')
								? 'automatic on'
								: 'automatic off'}
							<span class="block pt-1 text-xs font-semibold text-corduroy">
								Triggers when the current location is more than {wrongWayRouteBufferPx}px from the
								route.
							</span>
						</div>
						<section class="grid gap-4 rounded-2xl border border-[var(--hairline)] bg-white p-4">
							<div class="grid grid-cols-3 gap-2 text-xs font-bold text-corduroy">
								<div>
									<span class="block text-[0.65rem] tracking-[0.14em] uppercase">Mode</span>
									<span class="mt-1 block text-sm text-forest">{joystickLevelLabel}</span>
								</div>
								<div>
									<span class="block text-[0.65rem] tracking-[0.14em] uppercase">Direction</span>
									<span class="mt-1 block text-sm text-forest">{participantDirectionInput}°</span>
								</div>
								<div>
									<span class="block text-[0.65rem] tracking-[0.14em] uppercase">Point</span>
									<span class="mt-1 block text-sm text-forest">{participantCoordinateLabel}</span>
								</div>
							</div>

							<div class="grid justify-center">
								<div
									class="relative h-48 w-48 touch-none rounded-full border border-[var(--hairline-strong)] bg-canvas-mist disabled:opacity-40"
									class:opacity-40={!canUseWozControls}
									role="application"
									aria-label="Participant location joystick"
									onpointerdown={handleJoystickPointerDown}
									onpointermove={handleJoystickPointerMove}
									onpointerup={handleJoystickPointerEnd}
									onpointercancel={handleJoystickPointerEnd}
								>
									<div
										class="absolute top-1/2 left-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--hairline)] bg-white"
									></div>
									<div
										class="absolute top-1/2 left-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-leaf/60"
									></div>
									<div
										class="absolute top-1/2 left-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-attention/70"
									></div>
									<div
										class="absolute top-1/2 left-1/2 grid h-11 w-11 place-items-center rounded-full bg-forest text-white shadow-[0_10px_24px_rgba(20,66,46,0.22)]"
										style={joystickKnobStyle()}
									>
										<span
											class="block h-0 w-0 border-r-[6px] border-b-[12px] border-l-[6px] border-r-transparent border-b-white border-l-transparent"
											style={`transform: rotate(${participantDirectionInput}deg);`}
										></span>
									</div>
								</div>
							</div>

							<!-- <label class="grid gap-2 text-sm font-bold text-forest">
								Move speed: {participantSpeedInput}px
								<input
									type="range"
									min="2"
									max="30"
									step="1"
									value={participantSpeedInput}
									disabled={!canUseWozControls}
									oninput={(event) =>
										handleParticipantSpeedChange(
											Number((event.currentTarget as HTMLInputElement).value)
										)}
								/>
							</label> -->

							<div class="grid grid-cols-3 gap-2 text-[0.72rem] font-semibold text-corduroy">
								<span class="rounded-xl bg-canvas-mist px-3 py-2">Center holds</span>
								<span class="rounded-xl bg-mint px-3 py-2">Inner ring turns</span>
								<span class="rounded-xl bg-[#FFF3E5] px-3 py-2">Outer ring moves</span>
							</div>
						</section>
					</div>
				</article>
			{/if}

			{#if hasActiveDashboardSession && session}
				<article class="verde-card order-4 p-5 xl:col-span-2">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 class="text-xl font-bold">Participant screen preview</h2>
							<p class="mt-1 text-sm text-corduroy">
								Showing the active condition by default to reduce dashboard load.
							</p>
						</div>
						<span class="rounded-full border px-4 py-2 text-sm font-bold {conditionChipClass()}">
							{conditionLabel(session.activeCondition)}
						</span>
						<label
							class="inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-white px-4 py-2 text-sm font-bold text-forest"
						>
							<input type="checkbox" class="accent-leaf" bind:checked={showMultiplePreviews} />
							Compare both
						</label>
						<span
							class="rounded-full border border-[var(--hairline)] bg-white px-4 py-2 text-sm font-bold text-corduroy"
						>
							Scroll {Math.round((liveState?.scroll?.scrollPercent ?? 0) * 100)}%
						</span>
					</div>
					<div
						class="mt-4 grid justify-items-center gap-5 overflow-x-auto pb-2 xl:grid-cols-[auto_auto] xl:justify-center"
					>
						{#each previewConditions() as previewCondition}
							<div
								class="device-preview-shell overflow-hidden rounded-[28px] border bg-canvas-mist {previewBorderClass(
									previewCondition
								)}"
							>
								<p class="px-3 py-2 text-xs font-bold tracking-[0.18em] text-corduroy uppercase">
									{previewTitle(previewCondition)}
								</p>
								<div class="device-preview-frame">
									<div class="device-preview-viewport">
										<div class="device-preview-scroll" style={previewScrollStyle()}>
											<ParticipantRide
												{session}
												map={activeMap}
												{previewCondition}
												previewCompact={true}
												previewNow={dashboardNow}
											/>
										</div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</article>
			{/if}
		</section>
	</div>

	{#if isStudySetupOpen}
		<div class="fixed inset-0 z-50 overflow-auto bg-forest/45 p-4 backdrop-blur-sm">
			<section class="mx-auto max-w-3xl rounded-3xl bg-canvas-mist p-5 shadow-verde-ambient">
				<header class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p class="text-xs font-bold tracking-[0.22em] text-corduroy uppercase">
							Global configuration
						</p>
						<h2 class="mt-1 text-2xl font-bold text-forest">Study setup</h2>
						<p class="mt-2 max-w-2xl text-sm leading-6 text-corduroy">
							These values are shared by every participant. Participant records only choose
							participant ID and condition order.
						</p>
					</div>
					<button
						class="rounded-full border border-[var(--hairline)] bg-white px-5 py-3 text-sm font-bold"
						onclick={() => (isStudySetupOpen = false)}>Close</button
					>
				</header>

				{#if studySetupLocked}
					<p
						class="mt-4 rounded-2xl border border-attention bg-attention px-4 py-3 text-sm font-bold text-white"
					>
						Study setup is locked because at least one study session has started. New participant
						records will reuse this locked setup.
					</p>
				{/if}

				<div class="mt-5 grid gap-4">
					<label class="grid gap-1 text-sm font-bold">
						Total block length
						<div class="flex items-center gap-2">
							<input
								class="w-full rounded-2xl border border-[var(--hairline)] px-3 py-3 disabled:opacity-60"
								type="number"
								min="30"
								value={durationSeconds}
								disabled={studySetupLocked}
								oninput={(event) =>
									handleDurationInput((event.currentTarget as HTMLInputElement).value)}
							/>
							<span class="text-xs font-bold text-corduroy">sec</span>
						</div>
						<span class="text-xs font-medium text-corduroy"
							>Near-arrival handoff happens at the end of this block.</span
						>
					</label>

					<label class="flex items-start gap-3 rounded-2xl bg-mint/45 px-4 py-3 text-sm font-bold">
						<input
							class="mt-1 disabled:opacity-60"
							type="checkbox"
							bind:checked={includeDelay}
							disabled={studySetupLocked}
						/>
						<span>
							Include delay state
							<span class="block pt-1 text-xs leading-5 font-medium text-corduroy">
								When enabled, both Static (SIC) and Adaptive (AIC) pass through the same
								delay/revised ETA event.
							</span>
						</span>
					</label>

					<div class="grid gap-3 sm:grid-cols-2">
						<label class="grid gap-1 text-sm font-bold">
							Show delay at
							<div class="flex items-center gap-2">
								<input
									class="w-full rounded-2xl border border-[var(--hairline)] px-3 py-3 disabled:opacity-60"
									type="number"
									min="0"
									bind:value={delayAt}
									disabled={studySetupLocked || !includeDelay}
								/>
								<span class="text-xs font-bold text-corduroy">sec</span>
							</div>
						</label>
						<label class="grid gap-1 text-sm font-bold">
							Show near-arrival handoff at
							<div class="flex items-center gap-2">
								<input
									class="w-full rounded-2xl border border-[var(--hairline)] px-3 py-3 disabled:opacity-60"
									type="number"
									min="0"
									bind:value={nearArrivalAt}
									disabled={studySetupLocked}
								/>
								<span class="text-xs font-bold text-corduroy">sec</span>
							</div>
						</label>
						<label class="grid gap-1 text-sm font-bold">
							Selection countdown
							<div class="flex items-center gap-2">
								<input
									class="w-full rounded-2xl border border-[var(--hairline)] px-3 py-3 disabled:opacity-60"
									type="number"
									min="5"
									bind:value={selectionCountdownSeconds}
									disabled={studySetupLocked}
								/>
								<span class="text-xs font-bold text-corduroy">sec</span>
							</div>
						</label>
						<label class="grid gap-1 text-sm font-bold">
							Assignment duration
							<div class="flex items-center gap-2">
								<input
									class="w-full rounded-2xl border border-[var(--hairline)] px-3 py-3 disabled:opacity-60"
									type="number"
									min="1"
									bind:value={assignmentDurationSeconds}
									disabled={studySetupLocked}
								/>
								<span class="text-xs font-bold text-corduroy">sec</span>
							</div>
						</label>
						<label class="grid gap-1 text-sm font-bold">
							Handoff buffer
							<div class="flex items-center gap-2">
								<input
									class="w-full rounded-2xl border border-[var(--hairline)] px-3 py-3 disabled:opacity-60"
									type="number"
									min="1"
									bind:value={arrivalCompletionBufferSeconds}
									disabled={studySetupLocked}
								/>
								<span class="text-xs font-bold text-corduroy">sec</span>
							</div>
						</label>
						<label class="grid gap-1 text-sm font-bold">
							Ride ETA after handoff
							<div class="flex items-center gap-2">
								<input
									class="w-full rounded-2xl border border-[var(--hairline)] px-3 py-3 disabled:opacity-60"
									type="number"
									min="1"
									bind:value={rideEtaAfterArrivalMinutes}
									disabled={studySetupLocked}
								/>
								<span class="text-xs font-bold text-corduroy">min</span>
							</div>
						</label>
					</div>

					<p class="rounded-2xl bg-white px-4 py-3 text-xs leading-5 font-semibold text-corduroy">
						Current script: {timingSummary}
					</p>
					<button
						class="rounded-full bg-forest px-5 py-3 font-bold text-white disabled:opacity-40"
						disabled={studySetupLocked}
						onclick={handleSaveStudySetup}
					>
						Save study setup
					</button>
				</div>
			</section>
		</div>
	{/if}

	{#if isParticipantModalOpen}
		<div class="fixed inset-0 z-50 overflow-auto bg-forest/45 p-4 backdrop-blur-sm">
			<section class="mx-auto max-w-2xl rounded-3xl bg-canvas-mist p-5 shadow-verde-ambient">
				<header class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p class="text-xs font-bold tracking-[0.22em] text-corduroy uppercase">
							Participant records
						</p>
						<h2 class="mt-1 text-2xl font-bold text-forest">
							{selectedRegisteredParticipant ? 'Edit participant' : 'Add participant'}
						</h2>
						<p class="mt-2 max-w-xl text-sm leading-6 text-corduroy">
							The shared study setup is applied automatically. Only the participant record fields
							are edited here.
						</p>
					</div>
					<button
						class="rounded-full border border-[var(--hairline)] bg-white px-5 py-3 text-sm font-bold"
						onclick={() => (isParticipantModalOpen = false)}>Close</button
					>
				</header>

				<div class="mt-5 grid gap-4">
					<label class="grid gap-1 text-sm font-bold">
						Participant ID
						<input
							class="rounded-2xl border border-[var(--hairline)] px-4 py-3 font-medium"
							bind:value={participantId}
							placeholder="Free text ID"
						/>
						{#if selectedRegisteredParticipant}
							<span
								class="rounded-2xl border border-leaf bg-mint px-3 py-2 text-xs leading-5 font-bold text-forest"
							>
								Editing registered record: {selectedRegisteredParticipant.participantId}
							</span>
						{/if}
						{#if participantIdAlreadyUsed && !selectedRegisteredParticipant}
							<span
								class="rounded-2xl border bg-white px-3 py-2 text-xs leading-5 font-bold"
								class:border-leaf={participantIsRegistered}
								class:text-forest={participantIsRegistered}
								class:border-critical={!participantIsRegistered}
								class:text-critical={!participantIsRegistered}
							>
								{participantIsRegistered
									? 'This participant is already registered. Select it from the records list to start or edit.'
									: 'This participant ID already has a started or completed JSON export.'}
							</span>
						{/if}
					</label>

					<label class="grid gap-1 text-sm font-bold">
						Condition order
						<select
							class="rounded-2xl border border-[var(--hairline)] px-4 py-3"
							bind:value={conditionOrder}
						>
							<option value="SIC_AIC">Static (SIC) → Adaptive (AIC)</option>
							<option value="AIC_SIC">Adaptive (AIC) → Static (SIC)</option>
						</select>
					</label>

					<p class="rounded-2xl bg-white px-4 py-3 text-xs leading-5 font-semibold text-corduroy">
						Shared study setup: {studySetupLocked ? 'locked' : 'editable'} · {timingSummary}
					</p>

					<div class="grid gap-2">
						{#if selectedRegisteredParticipant}
							<button
								class="verde-focus rounded-full border border-leaf bg-white px-5 py-3 font-bold text-forest disabled:opacity-40"
								disabled={!canEditRegisteredParticipant}
								onclick={handleUpdateRegisteredParticipant}
							>
								Save record edits
							</button>
							<button
								class="verde-focus rounded-full border border-critical bg-white px-5 py-3 text-sm font-bold text-critical disabled:opacity-40"
								disabled={!canEditRegisteredParticipant}
								onclick={() => handleDeleteRegisteredParticipant()}
							>
								Remove record
							</button>
						{:else}
							<button
								class="verde-focus rounded-full border border-[var(--hairline-strong)] bg-white px-5 py-3 font-bold text-forest disabled:opacity-40"
								disabled={!canRegisterParticipant}
								onclick={handleRegisterParticipant}
							>
								Create participant record
							</button>
						{/if}
					</div>
					{#if statusMessage}<p class="rounded-2xl bg-mint px-4 py-3 text-sm font-bold">
							{statusMessage}
						</p>{/if}
				</div>
			</section>
		</div>
	{/if}

	{#if isMapBuilderOpen}
		<div class="fixed inset-0 z-50 overflow-auto bg-forest/45 p-4 backdrop-blur-sm">
			<section
				class="mx-auto grid min-h-[calc(100dvh-2rem)] max-w-7xl content-start gap-4 rounded-3xl bg-canvas-mist p-5 shadow-verde-ambient"
			>
				<header class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p class="text-xs font-bold tracking-[0.22em] text-corduroy uppercase">
							Environment setup
						</p>
						<h2 class="mt-1 text-2xl font-bold text-forest">Map builder</h2>
						<p class="mt-2 max-w-2xl text-sm leading-6 text-corduroy">
							Build the room once, save it locally, then select it in Session setup before the study
							starts. Click an object to select it. Click the canvas to place the selected start or
							end point.
						</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<button
							class="rounded-full border border-[var(--hairline)] bg-white px-5 py-3 text-sm font-bold"
							onclick={handleNewMap}>New map</button
						>
						<button
							class="rounded-full border border-[var(--hairline)] bg-white px-5 py-3 text-sm font-bold disabled:opacity-40"
							disabled={!editMap}
							onclick={handleDuplicateMap}>Duplicate</button
						>
						<button
							class="rounded-full bg-leaf px-5 py-3 text-sm font-bold text-white"
							onclick={saveEditMap}>Save map</button
						>
						<button
							class="rounded-full border border-critical bg-white px-5 py-3 text-sm font-bold text-critical disabled:opacity-40"
							disabled={!editMap || (session?.mapLocked && session.selectedMapId === editMap.id)}
							onclick={handleDeleteEditMap}
						>
							Delete map
						</button>
						<button
							class="rounded-full border border-[var(--hairline)] bg-white px-5 py-3 text-sm font-bold"
							onclick={() => (isMapBuilderOpen = false)}>Close</button
						>
					</div>
				</header>

				{#if editMap}
					<div class="grid gap-4 xl:grid-cols-[1fr_360px]">
						<div class="grid gap-4">
							<article class="verde-card p-4">
								<div class="grid gap-3 md:grid-cols-4">
									<label class="grid gap-1 text-sm font-bold">
										Edit map
										<select
											class="rounded-2xl border border-[var(--hairline)] px-4 py-3"
											value={editMap.id}
											onchange={(event) =>
												handleSelectEditMap((event.currentTarget as HTMLSelectElement).value)}
										>
											{#if !maps.some((map) => map.id === editMap?.id)}
												<option value={editMap.id}>{editMap.name} (unsaved)</option>
											{/if}
											{#each maps as map (map.id)}
												<option value={map.id}>{map.name}</option>
											{/each}
										</select>
									</label>
									<label class="grid gap-1 text-sm font-bold">
										Map ID
										<input
											class="rounded-2xl border border-[var(--hairline)] px-4 py-3"
											value={editMap.id}
											oninput={(event) =>
												updateMapMeta('id', (event.currentTarget as HTMLInputElement).value)}
										/>
									</label>
									<label class="grid gap-1 text-sm font-bold">
										Map name
										<input
											class="rounded-2xl border border-[var(--hairline)] px-4 py-3"
											value={editMap.name}
											oninput={(event) =>
												updateMapMeta('name', (event.currentTarget as HTMLInputElement).value)}
										/>
									</label>
									<label class="grid gap-1 text-sm font-bold">
										Room label
										<input
											class="rounded-2xl border border-[var(--hairline)] px-4 py-3"
											value={editMap.roomLabel}
											oninput={(event) =>
												updateMapMeta('roomLabel', (event.currentTarget as HTMLInputElement).value)}
										/>
									</label>
									<div class="grid grid-cols-2 gap-2">
										<label class="grid gap-1 text-sm font-bold">
											Width
											<input
												class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
												type="number"
												value={editMap.width}
												oninput={(event) =>
													updateMapMeta(
														'width',
														Number((event.currentTarget as HTMLInputElement).value)
													)}
											/>
										</label>
										<label class="grid gap-1 text-sm font-bold">
											Height
											<input
												class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
												type="number"
												value={editMap.height}
												oninput={(event) =>
													updateMapMeta(
														'height',
														Number((event.currentTarget as HTMLInputElement).value)
													)}
											/>
										</label>
									</div>
								</div>
							</article>

							<article class="verde-card overflow-hidden p-4">
								<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
									<div>
										<h3 class="text-lg font-bold">Canvas</h3>
										<p class="text-xs text-corduroy">
											Selected object: {selectedMapObject?.label ?? 'none'}
										</p>
									</div>
									<div
										class="flex rounded-full border border-[var(--hairline)] bg-white p-1 text-xs font-bold"
									>
										<button
											class="rounded-full px-3 py-2"
											class:bg-mint={placementTarget === 'start'}
											onclick={() => (placementTarget = 'start')}>Place start / point</button
										>
										<button
											class="rounded-full px-3 py-2 disabled:opacity-40"
											class:bg-mint={placementTarget === 'end'}
											disabled={!isLineObject(selectedMapObject)}
											onclick={() => (placementTarget = 'end')}>Place end</button
										>
									</div>
								</div>
								<button
									class="block w-full cursor-crosshair rounded-3xl text-left"
									onclick={handleEditorCanvasClick}
								>
									<svg
										bind:this={editorSvg}
										viewBox={`0 0 ${editMap.width} ${editMap.height}`}
										class="h-[620px] w-full rounded-3xl border border-[var(--hairline)] bg-white"
										role="img"
										aria-label={`Editor canvas for ${editMap.name}`}
									>
										<rect
											x="0"
											y="0"
											width={editMap.width}
											height={editMap.height}
											rx="28"
											fill="#F6FAF8"
										/>
										{#each sortedEditMapObjects as object (object.id)}
											{#if object.type === 'zone'}
												<rect
													x={object.x}
													y={object.y}
													width={object.width ?? 80}
													height={object.height ?? 48}
													rx="18"
													class={mapObjectStyle(object)}
													stroke-width={object.id === selectedMapObjectId ? 3 : 1.5}
												/>
												{#if object.triggerTags?.length}
													<text
														x={object.x + 8}
														y={object.y + 20}
														fill="#A74D3F"
														font-size="10"
														font-weight="700">trigger zone</text
													>
												{/if}
											{:else if object.type === 'road' || object.type === 'pedestrian_road'}
												<line
													x1={object.x}
													y1={object.y}
													x2={object.x2 ?? object.x + 120}
													y2={object.y2 ?? object.y}
													stroke={object.type === 'road' ? '#D9E3DF' : '#E8F4EF'}
													stroke-width={object.size ?? getObjectSize(object.type)}
													stroke-linecap="butt"
													opacity={object.type === 'road' ? 0.82 : 0.9}
												/>
												<line
													x1={object.x}
													y1={object.y}
													x2={object.x2 ?? object.x + 120}
													y2={object.y2 ?? object.y}
													stroke={object.type === 'road' ? '#FFFFFF' : '#8BAEA0'}
													stroke-width={object.type === 'road' ? 2.5 : 1.5}
													stroke-dasharray={object.type === 'road' ? '14 12' : '5 7'}
													stroke-linecap="butt"
													opacity={object.type === 'road' ? 0.55 : 0.42}
												/>
												<circle
													cx={object.x}
													cy={object.y}
													r="7"
													class={object.id === selectedMapObjectId
														? 'fill-critical'
														: 'fill-white stroke-forest'}
													stroke-width="2"
												/>
												<circle
													cx={object.x2 ?? object.x + 120}
													cy={object.y2 ?? object.y}
													r="7"
													class={object.id === selectedMapObjectId
														? 'fill-critical'
														: 'fill-white stroke-leaf'}
													stroke-width="2"
												/>
											{:else if object.type === 'wall' || object.type === 'path' || object.type === 'shuttle_path'}
												<line
													x1={object.x}
													y1={object.y}
													x2={object.x2 ?? object.x + 80}
													y2={object.y2 ?? object.y}
													class={object.type === 'path' ? 'stroke-leaf' : mapObjectStyle(object)}
													stroke-width={object.size ?? getObjectSize(object.type)}
													stroke-linecap="round"
													stroke-dasharray={object.type === 'shuttle_path' ? '8 8' : undefined}
												/>
												<circle
													cx={object.x}
													cy={object.y}
													r="7"
													class={object.id === selectedMapObjectId
														? 'fill-critical'
														: 'fill-white stroke-forest'}
													stroke-width="2"
												/>
												<circle
													cx={object.x2 ?? object.x + 80}
													cy={object.y2 ?? object.y}
													r="7"
													class={object.id === selectedMapObjectId
														? 'fill-critical'
														: 'fill-white stroke-leaf'}
													stroke-width="2"
												/>
											{:else if object.type === 'label'}
												<text
													x={object.x}
													y={object.y}
													fill={object.id === selectedMapObjectId ? '#A74D3F' : '#14422E'}
													font-size={object.size ?? 13}
													font-weight="700"
												>
													{object.label}
												</text>
											{:else if object.type === 'obstacle'}
												<rect
													x={object.x}
													y={object.y}
													width={object.width ?? 44}
													height={object.height ?? 34}
													rx="12"
													class={mapObjectStyle(object)}
													stroke-width={object.id === selectedMapObjectId ? 3 : 1.5}
												/>
												<text x={object.x + 8} y={object.y + 22} fill="#14422E" font-size="10"
													>{object.label}</text
												>
											{:else}
												<g>
													{#if object.type === 'shuttle'}
														<g transform={`translate(${object.x} ${object.y})`}>
															<rect
																x="-17"
																y="-10"
																width="34"
																height="20"
																rx="8"
																class={mapObjectStyle(object)}
																stroke-width={object.id === selectedMapObjectId ? 3 : 2}
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
													{:else if object.type === 'pickup' || object.type === 'participant_start' || object.type === 'current_location'}
														<g transform={`translate(${object.x} ${object.y})`}>
															<path
																d="M0 -15 C8 -15 14 -9 14 -1 C14 8 3 17 0 20 C-3 17 -14 8 -14 -1 C-14 -9 -8 -15 0 -15 Z"
																class={mapObjectStyle(object)}
																stroke-width={object.id === selectedMapObjectId ? 3 : 2}
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
															cx={object.x}
															cy={object.y}
															r={object.size ?? 11}
															class={mapObjectStyle(object)}
															stroke-width={object.id === selectedMapObjectId ? 3 : 2}
														/>
													{/if}
													<text
														x={object.x + (object.size ?? 11) + 6}
														y={object.y + 4}
														fill="#263C34"
														font-size="11"
														font-weight="600">{object.label}</text
													>
												</g>
											{/if}
										{/each}
										{#if editMapViewports}
											{#each mapViewportItems as viewportItem (viewportItem.key)}
												{@const viewport = editMapViewports[viewportItem.key]}
												<g class="pointer-events-none">
													<rect
														x={viewport.x}
														y={viewport.y}
														width={viewport.width}
														height={viewport.height}
														rx="18"
														fill="none"
														stroke={viewportStroke(viewportItem.key)}
														stroke-width={viewportStrokeWidth(viewportItem.key)}
														stroke-dasharray={viewportItem.key === 'expanded' ? '14 10' : undefined}
														opacity="0.95"
													/>
													<rect
														x={viewport.x + 8}
														y={viewport.y + 8}
														width={viewportItem.key === 'expanded' ? 116 : 102}
														height="24"
														rx="12"
														fill="white"
														stroke={viewportStroke(viewportItem.key)}
														stroke-width="1.5"
													/>
													<text
														x={viewport.x + 18}
														y={viewport.y + 24}
														fill={viewportStroke(viewportItem.key)}
														font-size="11"
														font-weight="800"
													>
														{viewportItem.label}
													</text>
												</g>
											{/each}
										{/if}
									</svg>
								</button>
							</article>
						</div>

						<aside class="grid content-start gap-4">
							<article class="verde-card p-4">
								<div class="flex items-start justify-between gap-3">
									<div>
										<h3 class="text-lg font-bold">View rectangles</h3>
										<p class="mt-1 text-xs leading-5 text-corduroy">
											Default is the current app view. Expanded is used by the full map view.
										</p>
									</div>
									<span class="rounded-full bg-mint px-3 py-1 text-xs font-bold text-forest">
										2 views
									</span>
								</div>
								<div class="mt-3 grid grid-cols-2 gap-2">
									{#each mapViewportItems as viewportItem}
										<button
											class="rounded-2xl border px-3 py-2 text-left text-xs font-bold"
											class:border-critical={selectedViewportKey === viewportItem.key}
											class:bg-mint={selectedViewportKey === viewportItem.key}
											class:border-[var(--hairline)]={selectedViewportKey !== viewportItem.key}
											onclick={() => (selectedViewportKey = viewportItem.key)}
										>
											<span class="block" style={`color: ${viewportItem.stroke}`}>
												{viewportItem.label}
											</span>
											<span class="font-medium text-corduroy">
												{editMapViewports?.[viewportItem.key].width ?? 0} × {editMapViewports?.[
													viewportItem.key
												].height ?? 0}
											</span>
										</button>
									{/each}
								</div>
								<section
									class="mt-4 grid gap-3 rounded-2xl border border-[var(--hairline)] bg-white p-3 text-sm font-bold"
								>
									<span class="text-xs tracking-[0.14em] text-corduroy uppercase">
										Initial app view
									</span>
									<select
										class="rounded-2xl border border-[var(--hairline)] px-4 py-3"
										value={editMapInitialViewport}
										onchange={(event) =>
											updateInitialViewport(
												(event.currentTarget as HTMLSelectElement).value as StudyMapViewportKey
											)}
									>
										{#each mapViewportItems as viewportItem}
											<option value={viewportItem.key}>{viewportItem.label}</option>
										{/each}
									</select>
									<div class="grid grid-cols-3 gap-2">
										<label class="grid gap-1 text-xs font-bold text-forest">
											Zoom
											<input
												class="rounded-2xl border border-[var(--hairline)] px-3 py-2"
												type="number"
												min="1"
												max="4"
												step="0.05"
												value={editMapInitialView.zoom}
												oninput={(event) =>
													updateInitialView({
														zoom: Number((event.currentTarget as HTMLInputElement).value)
													})}
											/>
										</label>
										<label class="grid gap-1 text-xs font-bold text-forest">
											Pan X
											<input
												class="rounded-2xl border border-[var(--hairline)] px-3 py-2"
												type="number"
												step="1"
												value={editMapInitialView.panX}
												oninput={(event) =>
													updateInitialView({
														panX: Number((event.currentTarget as HTMLInputElement).value)
													})}
											/>
										</label>
										<label class="grid gap-1 text-xs font-bold text-forest">
											Pan Y
											<input
												class="rounded-2xl border border-[var(--hairline)] px-3 py-2"
												type="number"
												step="1"
												value={editMapInitialView.panY}
												oninput={(event) =>
													updateInitialView({
														panY: Number((event.currentTarget as HTMLInputElement).value)
													})}
											/>
										</label>
									</div>
									<button
										class="justify-self-start rounded-full border border-[var(--hairline)] bg-white px-4 py-2 text-xs font-bold"
										type="button"
										onclick={resetInitialViewTransform}
									>
										Reset zoom and pan
									</button>
									<span class="text-xs leading-5 font-medium text-corduroy">
										Participant maps first open from this view, zoom, and pan. Manual zoom and pan
										still carry between inline and modal maps.
									</span>
								</section>
								{#if selectedViewport}
									<div class="mt-3 grid gap-3">
										<div class="grid grid-cols-2 gap-3">
											<label class="grid gap-1 text-sm font-bold">
												X
												<input
													class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
													type="number"
													value={selectedViewport.x}
													oninput={(event) =>
														updateMapViewport(selectedViewportKey, {
															x: Number((event.currentTarget as HTMLInputElement).value)
														})}
												/>
											</label>
											<label class="grid gap-1 text-sm font-bold">
												Y
												<input
													class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
													type="number"
													value={selectedViewport.y}
													oninput={(event) =>
														updateMapViewport(selectedViewportKey, {
															y: Number((event.currentTarget as HTMLInputElement).value)
														})}
												/>
											</label>
											<label class="grid gap-1 text-sm font-bold">
												Width
												<input
													class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
													type="number"
													min="1"
													value={selectedViewport.width}
													oninput={(event) =>
														updateMapViewport(selectedViewportKey, {
															width: Number((event.currentTarget as HTMLInputElement).value)
														})}
												/>
											</label>
											<label class="grid gap-1 text-sm font-bold">
												Height
												<input
													class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
													type="number"
													min="1"
													value={selectedViewport.height}
													oninput={(event) =>
														updateMapViewport(selectedViewportKey, {
															height: Number((event.currentTarget as HTMLInputElement).value)
														})}
												/>
											</label>
										</div>
										<button
											class="rounded-full border border-[var(--hairline)] bg-white px-4 py-3 text-sm font-bold"
											onclick={() => useFullCanvasForViewport(selectedViewportKey)}
										>
											Use full canvas
										</button>
									</div>
								{/if}
							</article>

							<article class="verde-card p-4">
								<h3 class="text-lg font-bold">Objects</h3>
								<div class="mt-3 flex gap-2">
									<select
										class="flex-1 rounded-full border border-[var(--hairline)] px-4 py-3 text-sm font-bold"
										bind:value={newObjectType}
									>
										{#each mapObjectTypes as type}
											<option value={type}>{objectTypeLabel(type)}</option>
										{/each}
									</select>
									<button
										class="rounded-full bg-forest px-4 py-3 text-sm font-bold text-white"
										onclick={addMapObject}>Add</button
									>
								</div>
								<div class="mt-3 grid max-h-56 gap-2 overflow-auto">
									{#each sortedEditMapObjects as object (object.id)}
										<button
											class="rounded-2xl border px-3 py-2 text-left text-sm font-bold"
											class:border-critical={object.id === selectedMapObjectId}
											class:bg-mint={object.id === selectedMapObjectId}
											class:border-[var(--hairline)]={object.id !== selectedMapObjectId}
											onclick={() => (selectedMapObjectId = object.id)}
										>
											<span class="block">{object.label}</span>
											<span class="text-xs font-medium text-corduroy"
												>{objectTypeLabel(object.type)}</span
											>
										</button>
									{/each}
								</div>
							</article>

							<article class="verde-card p-4">
								<h3 class="text-lg font-bold">Selected object</h3>
								{#if selectedMapObject}
									<div class="mt-3 grid gap-3">
										<label class="grid gap-1 text-sm font-bold">
											Label
											<input
												class="rounded-2xl border border-[var(--hairline)] px-4 py-3"
												value={selectedMapObject.label}
												oninput={(event) =>
													updateMapObject(selectedMapObject.id, {
														label: (event.currentTarget as HTMLInputElement).value
													})}
											/>
										</label>
										<label class="grid gap-1 text-sm font-bold">
											Type
											<select
												class="rounded-2xl border border-[var(--hairline)] px-4 py-3"
												value={selectedMapObject.type}
												onchange={(event) => {
													const type = (event.currentTarget as HTMLSelectElement)
														.value as MapObjectType;
													updateMapObject(selectedMapObject.id, {
														type,
														size: getObjectSize(type),
														width:
															type === 'zone' || type === 'obstacle'
																? (selectedMapObject.width ?? 92)
																: undefined,
														height:
															type === 'zone' || type === 'obstacle'
																? (selectedMapObject.height ?? 56)
																: undefined,
														x2: isLineType(type)
															? (selectedMapObject.x2 ?? selectedMapObject.x + 120)
															: undefined,
														y2: isLineType(type)
															? (selectedMapObject.y2 ?? selectedMapObject.y)
															: undefined,
														zIndex: defaultZIndex(type)
													});
												}}
											>
												{#each mapObjectTypes as type}
													<option value={type}>{objectTypeLabel(type)}</option>
												{/each}
											</select>
										</label>
										<div class="grid grid-cols-2 gap-3">
											<label class="grid gap-1 text-sm font-bold">
												X
												<input
													class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
													type="number"
													value={selectedMapObject.x}
													oninput={(event) =>
														updateMapObject(selectedMapObject.id, {
															x: Number((event.currentTarget as HTMLInputElement).value)
														})}
												/>
											</label>
											<label class="grid gap-1 text-sm font-bold">
												Y
												<input
													class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
													type="number"
													value={selectedMapObject.y}
													oninput={(event) =>
														updateMapObject(selectedMapObject.id, {
															y: Number((event.currentTarget as HTMLInputElement).value)
														})}
												/>
											</label>
										</div>
										<label class="grid gap-1 text-sm font-bold">
											Z index
											<input
												class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
												type="number"
												value={selectedMapObject.zIndex ?? defaultZIndex(selectedMapObject.type)}
												oninput={(event) =>
													updateMapObject(selectedMapObject.id, {
														zIndex: Number((event.currentTarget as HTMLInputElement).value)
													})}
											/>
										</label>
										{#if isLineObject(selectedMapObject)}
											<div class="grid grid-cols-2 gap-3">
												<label class="grid gap-1 text-sm font-bold">
													End X
													<input
														class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
														type="number"
														value={selectedMapObject.x2 ?? selectedMapObject.x + 80}
														oninput={(event) =>
															updateMapObject(selectedMapObject.id, {
																x2: Number((event.currentTarget as HTMLInputElement).value)
															})}
													/>
												</label>
												<label class="grid gap-1 text-sm font-bold">
													End Y
													<input
														class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
														type="number"
														value={selectedMapObject.y2 ?? selectedMapObject.y}
														oninput={(event) =>
															updateMapObject(selectedMapObject.id, {
																y2: Number((event.currentTarget as HTMLInputElement).value)
															})}
													/>
												</label>
											</div>
										{/if}
										{#if isRectangleObject(selectedMapObject)}
											<div class="grid grid-cols-2 gap-3">
												<label class="grid gap-1 text-sm font-bold">
													Width
													<input
														class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
														type="number"
														value={selectedMapObject.width ?? 80}
														oninput={(event) =>
															updateMapObject(selectedMapObject.id, {
																width: Number((event.currentTarget as HTMLInputElement).value)
															})}
													/>
												</label>
												<label class="grid gap-1 text-sm font-bold">
													Height
													<input
														class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
														type="number"
														value={selectedMapObject.height ?? 48}
														oninput={(event) =>
															updateMapObject(selectedMapObject.id, {
																height: Number((event.currentTarget as HTMLInputElement).value)
															})}
													/>
												</label>
											</div>
										{/if}
										{#if usesSize(selectedMapObject)}
											<label class="grid gap-1 text-sm font-bold">
												{isLineObject(selectedMapObject)
													? 'Line size'
													: selectedMapObject.type === 'label'
														? 'Text size'
														: 'Marker size'}
												<input
													class="rounded-2xl border border-[var(--hairline)] px-3 py-3"
													type="number"
													min="1"
													value={selectedMapObject.size ?? getObjectSize(selectedMapObject.type)}
													oninput={(event) =>
														updateMapObject(selectedMapObject.id, {
															size: Number((event.currentTarget as HTMLInputElement).value)
														})}
												/>
											</label>
										{/if}
										{#if selectedMapObject.type === 'zone'}
											<label
												class="flex items-start gap-3 rounded-2xl bg-mint/45 px-4 py-3 text-sm font-bold"
											>
												<input
													class="mt-1"
													type="checkbox"
													checked={selectedMapObject.participantVisible !== false}
													onchange={(event) =>
														updateMapObject(selectedMapObject.id, {
															participantVisible: (event.currentTarget as HTMLInputElement).checked
														})}
												/>
												<span>
													Show zone in participant app
													<span class="block pt-1 text-xs leading-5 font-medium text-corduroy">
														Trigger zones are always hidden from the participant, even if this is
														enabled.
													</span>
												</span>
											</label>
										{/if}
										<div class="rounded-2xl border border-[var(--hairline)] bg-white p-3">
											<p class="text-xs font-bold tracking-[0.16em] text-corduroy uppercase">
												Trigger tags
											</p>
											<p class="mt-1 text-xs leading-5 text-corduroy">
												Add tags to make this object a trigger region. Tagged zones stay
												researcher-facing only.
											</p>
											<div class="mt-3 grid gap-2">
												{#each mapTriggerTags as trigger}
													<label
														class="flex items-start gap-2 rounded-xl bg-canvas-mist px-3 py-2 text-xs font-semibold"
													>
														<input
															class="mt-0.5"
															type="checkbox"
															checked={Boolean(
																selectedMapObject.triggerTags?.includes(trigger.tag)
															)}
															onchange={() =>
																toggleMapObjectTrigger(selectedMapObject.id, trigger.tag)}
														/>
														<span>
															<span class="block font-bold text-forest">{trigger.label}</span>
															<span class="block pt-0.5 text-corduroy">{trigger.description}</span>
														</span>
													</label>
												{/each}
											</div>
										</div>
										<div class="rounded-2xl border border-[var(--hairline)] bg-white p-3">
											<p class="text-xs font-bold tracking-[0.16em] text-corduroy uppercase">
												Conditional visibility
											</p>
											<p class="mt-1 text-xs leading-5 text-corduroy">
												Use this when a non-trigger object should appear or disappear after a
												trigger is activated.
											</p>
											<div class="mt-3 grid gap-3">
												<div>
													<p class="text-xs font-bold text-forest">Show when active</p>
													<div class="mt-2 grid gap-2">
														{#each mapTriggerTags as trigger}
															<label
																class="flex items-center gap-2 text-xs font-semibold text-corduroy"
															>
																<input
																	type="checkbox"
																	checked={Boolean(
																		selectedMapObject.showWhenTriggers?.includes(trigger.tag)
																	)}
																	onchange={() =>
																		toggleTriggerVisibilityList(
																			selectedMapObject.id,
																			'showWhenTriggers',
																			trigger.tag
																		)}
																/>
																{trigger.label}
															</label>
														{/each}
													</div>
												</div>
												<div>
													<p class="text-xs font-bold text-forest">Hide when active</p>
													<div class="mt-2 grid gap-2">
														{#each mapTriggerTags as trigger}
															<label
																class="flex items-center gap-2 text-xs font-semibold text-corduroy"
															>
																<input
																	type="checkbox"
																	checked={Boolean(
																		selectedMapObject.hideWhenTriggers?.includes(trigger.tag)
																	)}
																	onchange={() =>
																		toggleTriggerVisibilityList(
																			selectedMapObject.id,
																			'hideWhenTriggers',
																			trigger.tag
																		)}
																/>
																{trigger.label}
															</label>
														{/each}
													</div>
												</div>
											</div>
										</div>
										<button
											class="rounded-full border border-critical bg-white px-4 py-3 text-sm font-bold text-critical"
											onclick={() => removeMapObject(selectedMapObject.id)}
										>
											Remove selected object
										</button>
									</div>
								{:else}
									<p class="mt-3 rounded-2xl bg-white px-4 py-3 text-sm text-corduroy">
										Select or add an object to edit its geometry.
									</p>
								{/if}
							</article>
						</aside>
					</div>
				{:else}
					<div class="verde-card p-6">
						<p class="text-sm text-corduroy">No maps available yet.</p>
					</div>
				{/if}
			</section>
		</div>
	{/if}
</main>

<style>
	.device-preview-shell {
		width: calc(440px * 0.48);
	}

	.device-preview-frame {
		width: calc(440px * 0.48);
		height: calc(956px * 0.48);
		overflow: hidden;
		background: #f6faf8;
	}

	.device-preview-viewport {
		width: 440px;
		height: 956px;
		transform: scale(0.48);
		transform-origin: top left;
		pointer-events: none;
	}

	.device-preview-scroll {
		will-change: transform;
		transition: transform 180ms linear;
	}

	@media (min-width: 1536px) {
		.device-preview-shell,
		.device-preview-frame {
			width: calc(440px * 0.56);
		}

		.device-preview-frame {
			height: calc(956px * 0.56);
		}

		.device-preview-viewport {
			transform: scale(0.56);
		}
	}
</style>
