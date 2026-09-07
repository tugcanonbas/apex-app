export type Condition = 'sic' | 'aic';
export type ConditionOrder = 'SIC_AIC' | 'AIC_SIC';
export type StudyPhase =
	| 'booking'
	| 'assignment'
	| 'waiting'
	| 'delay'
	| 'near_arrival'
	| 'arrival';
export type SicBoardingStep = 1 | 2 | 3 | 4;
export type SessionStatus =
	| 'idle'
	| 'ready'
	| 'running'
	| 'paused'
	| 'completed'
	| 'study_finished'
	| 'cancelled';
export type RideRequestStatus = 'none' | 'selected' | 'requested' | 'assigned' | 'cancelled';
export type MapObjectType =
	| 'wall'
	| 'road'
	| 'pedestrian_road'
	| 'path'
	| 'shuttle_path'
	| 'pickup'
	| 'participant_start'
	| 'current_location'
	| 'shuttle'
	| 'label'
	| 'zone'
	| 'obstacle';

export type MapTriggerTag =
	| 'pickup_zone_enter'
	| 'pickup_zone_exit'
	| 'shuttle_arriving_zone_enter'
	| 'shuttle_arriving_zone_exit'
	| 'participant_route_start'
	| 'participant_midroute_enter'
	| 'path_area_1_enter'
	| 'path_area_2_enter'
	| 'path_area_3_enter'
	| 'path_area_4_enter'
	| 'participant_wrong_way'
	| 'participant_waiting_zone_enter'
	| 'participant_waiting_zone_exit'
	| 'boarding_zone_enter'
	| 'boarding_zone_exit'
	| 'delay_notice_shown'
	| 'revised_eta_acknowledged';

export type ScenarioTiming = {
	delay: number;
	near_arrival: number;
	arrival: number;
};

export type ScenarioConfig = {
	durationSeconds: number;
	includeDelay: boolean;
	initialEtaSeconds: number;
	revisedEtaSeconds: number;
	selectionCountdownSeconds: number;
	assignmentDurationSeconds: number;
	arrivalCompletionBufferSeconds: number;
	rideEtaAfterArrivalMinutes: number;
	timings: ScenarioTiming;
	phaseCopy: Record<
		StudyPhase | 'ready' | 'offline' | 'block_finished' | 'study_finished',
		{
			eyebrow: string;
			title: string;
			body: string;
		}
	>;
	microUpdates: Record<StudyPhase, string[]>;
	vehicleIdentifiers: string[];
	supportMock: {
		label: string;
		body: string;
		cancelLabel: string;
	};
	rideOptions: RideOption[];
};

export type RideOption = {
	id: string;
	label: string;
	pickupPoint: string;
	destination: string;
	waitMinutes: number;
	walkMinutes: number;
	rideMinutes: number;
	arrivalTime: string;
	vehicleType: string;
	vehicleId: string;
	occupancy: string;
	co2SavedKg: number;
	batteryPercent: number;
	comfort: string;
	routeSummary: string;
	recommendationReason: string;
	tags: string[];
	isRecommended?: boolean;
};

export type StudyMapObject = {
	id: string;
	type: MapObjectType;
	label: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
	x2?: number;
	y2?: number;
	size?: number;
	zIndex?: number;
	locked?: boolean;
	participantVisible?: boolean;
	triggerTags?: MapTriggerTag[];
	showWhenTriggers?: MapTriggerTag[];
	hideWhenTriggers?: MapTriggerTag[];
};

export type StudyMapViewportKey = 'default' | 'expanded';

export type StudyMapViewport = {
	x: number;
	y: number;
	width: number;
	height: number;
	label?: string;
};

export type StudyMapInitialView = {
	viewport: StudyMapViewportKey;
	zoom: number;
	panX: number;
	panY: number;
};

export type StudyMap = {
	id: string;
	name: string;
	roomLabel: string;
	width: number;
	height: number;
	initialViewport?: StudyMapViewportKey;
	initialView?: StudyMapInitialView;
	viewports?: Record<StudyMapViewportKey, StudyMapViewport>;
	objects: StudyMapObject[];
	createdAt: string;
	updatedAt: string;
};

export type RouteMapViewState = {
	mapId?: string;
	viewportMode: StudyMapViewportKey;
	zoom: number;
	panX: number;
	panY: number;
	visibleViewport?: StudyMapViewport | null;
	updatedAt: number;
};

export type RouteMapInteractionAction =
	| 'tap'
	| 'pan'
	| 'reset'
	| 'zoom_in'
	| 'zoom_out'
	| 'wheel_zoom';

export type RouteMapInteractionPayload = {
	action: RouteMapInteractionAction;
	source: string;
	mapId?: string;
	mapName?: string;
	phase: StudyPhase;
	initialViewport?: StudyMapViewportKey;
	viewportMode: StudyMapViewportKey;
	zoom: number;
	panX: number;
	panY: number;
	previousZoom?: number;
	visibleViewport?: StudyMapViewport | null;
	durationMs?: number;
	distancePx?: number;
};

export type StudyEvent = {
	id: string;
	timestamp: string;
	participantId?: string;
	block?: number;
	condition?: Condition;
	phase?: StudyPhase;
	screen?: string;
	type: string;
	source: 'dashboard' | 'participant_app' | 'automation' | 'system';
	payload?: Record<string, unknown>;
};

export type SessionLiveState = {
	sessionId: string;
	participantId: string;
	block: number;
	condition: Condition;
	phase: StudyPhase;
	updatedAt: string;
	locationOverride?: LocationOverride;
	activeTriggerTags?: MapTriggerTag[];
	scroll?: {
		scrollY: number;
		scrollHeight: number;
		clientHeight: number;
		scrollPercent: number;
	};
};

export type BlockState = {
	block: number;
	condition: Condition;
	selectedRideOptionId?: string;
	assignmentFallbackFromOptionId?: string;
	rideRequestStatus: RideRequestStatus;
	startedAt?: string;
	selectedAt?: string;
	requestedAt?: string;
	assignedAt?: string;
	cancelledAt?: string;
	timeToRequestSeconds?: number;
	completedAt?: string;
	questionnaireCompletedAt?: string;
	events: StudyEvent[];
};

export type AutomationState = {
	startedAt?: string;
	pausedAt?: string;
	elapsedBeforePauseSeconds: number;
};

export type LocationOverride = {
	participantProgress?: number;
	participantX?: number;
	participantY?: number;
	participantDirectionDegrees?: number;
	participantSpeed?: number;
	participantControlLevel?: 0 | 1 | 2;
	shuttleProgress?: number;
	updatedAt?: string;
};

export type StudySession = {
	sessionId: string;
	participantId: string;
	conditionOrder: ConditionOrder;
	activeBlock: 1 | 2;
	activeCondition: Condition;
	phase: StudyPhase;
	status: SessionStatus;
	selectedMapId: string;
	mapLocked: boolean;
	scenario: ScenarioConfig;
	automation: AutomationState;
	locationOverride?: LocationOverride;
	sicBoardingStep?: SicBoardingStep;
	activeTriggerTags?: MapTriggerTag[];
	triggerZoneState?: Record<string, boolean>;
	notes: string;
	technicalIssues: string[];
	createdAt: string;
	updatedAt: string;
	blocks: BlockState[];
	events: StudyEvent[];
};

export type ParticipantRecord = {
	participantId: string;
	sessionId?: string;
	conditionOrder: ConditionOrder;
	selectedMapId: string;
	scenario?: ScenarioConfig;
	registrationStatus?: 'registered' | 'started' | 'completed';
	locationOverride?: LocationOverride;
	sicBoardingStep?: SicBoardingStep;
	activeTriggerTags?: MapTriggerTag[];
	triggerZoneState?: Record<string, boolean>;
	notes: string;
	technicalIssues: string[];
	createdAt: string;
	updatedAt: string;
	blocks: BlockState[];
	events: StudyEvent[];
};

export type ParticipantSummary = {
	participantId: string;
	sessionId?: string;
	conditionOrder: ConditionOrder;
	selectedMapId: string;
	scenario?: ScenarioConfig;
	createdAt: string;
	updatedAt: string;
	completedBlocks: number;
	totalBlocks: number;
	status: 'registered' | 'in_progress' | 'completed';
};

export type StateResponse = {
	session: StudySession | null;
	map: StudyMap | null;
	maps: StudyMap[];
	participants: ParticipantSummary[];
	live: SessionLiveState | null;
	now: string;
};

export const phases: StudyPhase[] = ['booking', 'assignment', 'waiting', 'delay', 'near_arrival'];

export const mapObjectTypes: MapObjectType[] = [
	'wall',
	'road',
	'pedestrian_road',
	'path',
	'shuttle_path',
	'pickup',
	'participant_start',
	'current_location',
	'shuttle',
	'label',
	'zone',
	'obstacle'
];

export const mapTriggerTags: { tag: MapTriggerTag; label: string; description: string }[] = [
	{
		tag: 'pickup_zone_enter',
		label: 'Pickup zone enter',
		description: 'Participant has reached the pickup area.'
	},
	{
		tag: 'pickup_zone_exit',
		label: 'Pickup zone exit',
		description: 'Participant moved away from the pickup area.'
	},
	{
		tag: 'shuttle_arriving_zone_enter',
		label: 'Shuttle arriving zone enter',
		description: 'Shuttle entered the final approach area.'
	},
	{
		tag: 'shuttle_arriving_zone_exit',
		label: 'Shuttle arriving zone exit',
		description: 'Shuttle left the final approach area.'
	},
	{
		tag: 'participant_route_start',
		label: 'Participant route start',
		description: 'Participant has started moving along the mapped route.'
	},
	{
		tag: 'participant_midroute_enter',
		label: 'Mid-route enter',
		description: 'Participant reached a midpoint or decision point.'
	},
	{
		tag: 'path_area_1_enter',
		label: 'Path area 1 enter',
		description: 'Participant entered the first route segment.'
	},
	{
		tag: 'path_area_2_enter',
		label: 'Path area 2 enter',
		description: 'Participant entered the second route segment.'
	},
	{
		tag: 'path_area_3_enter',
		label: 'Path area 3 enter',
		description: 'Participant entered the third route segment.'
	},
	{
		tag: 'path_area_4_enter',
		label: 'Path area 4 enter',
		description: 'Participant entered the final route segment near pickup.'
	},
	{
		tag: 'participant_wrong_way',
		label: 'Wrong way',
		description: 'Researcher-triggered cue when the participant is walking away from the route.'
	},
	{
		tag: 'participant_waiting_zone_enter',
		label: 'Waiting zone enter',
		description: 'Participant entered the intended waiting area.'
	},
	{
		tag: 'participant_waiting_zone_exit',
		label: 'Waiting zone exit',
		description: 'Participant left the intended waiting area.'
	},
	{
		tag: 'boarding_zone_enter',
		label: 'Boarding zone enter',
		description: 'Participant is in the boarding-ready area.'
	},
	{
		tag: 'boarding_zone_exit',
		label: 'Boarding zone exit',
		description: 'Participant moved away from the boarding-ready area.'
	},
	{
		tag: 'delay_notice_shown',
		label: 'Delay notice shown',
		description: 'Delay state was shown and can foreground recovery guidance.'
	},
	{
		tag: 'revised_eta_acknowledged',
		label: 'Revised ETA acknowledged',
		description: 'Participant has seen or acknowledged the revised timing.'
	}
];

export function conditionLabel(condition: Condition): string {
	return condition === 'sic' ? 'Static (SIC)' : 'Adaptive (AIC)';
}

export function participantConditionLabel(condition: Condition): string {
	return condition === 'sic' ? 'VERDĒ' : 'VERDĒ';
}

export function phaseLabel(phase: StudyPhase): string {
	return phase
		.split('_')
		.map((part) => part[0].toUpperCase() + part.slice(1))
		.join(' ');
}
