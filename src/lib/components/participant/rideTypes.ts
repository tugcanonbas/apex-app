import type { MapTriggerTag, RideOption, StudyMap, StudyPhase } from '$lib/types';

export type IconName =
	| 'battery'
	| 'leaf'
	| 'users'
	| 'clock'
	| 'walk'
	| 'route'
	| 'shield'
	| 'check'
	| 'map'
	| 'bolt'
	| 'seat'
	| 'vehicle'
	| 'alert'
	| 'navigation'
	| 'headset'
	| 'id'
	| 'progress';

export type RideModule =
	| 'hero'
	| 'map'
	| 'guidance'
	| 'vehicle'
	| 'pickup'
	| 'timeline'
	| 'details';

export type TriggerDecision = {
	sicTitle: string;
	aicTitle: string;
	body: string;
	update: string;
	tone: 'route' | 'wait' | 'delay' | 'boarding' | 'arrival';
};

export type DetailTopic =
	| 'planning'
	| 'option'
	| 'route'
	| 'timing'
	| 'vehicle'
	| 'pickup'
	| 'sustainability'
	| 'boarding';

export type DetailItem = {
	icon: IconName;
	label: string;
	value: string;
	body?: string;
};

export type DetailContent = {
	eyebrow: string;
	title: string;
	body: string;
	items: DetailItem[];
	primary?: string;
	sections?: {
		title: string;
		body: string;
		items: string[];
	}[];
};

export type JourneyStep = { key: StudyPhase; label: string };

export type JourneyStepState = JourneyStep & {
	state: 'active' | 'done' | 'pending';
};

export type RouteMapViewProps = {
	map: StudyMap | null;
	phase: StudyPhase;
	adaptive: boolean;
	showLabels: boolean;
	showAllPickups: boolean;
	selectedPickup?: string;
	participantProgress?: number;
	participantX?: number;
	participantY?: number;
	participantDirectionDegrees?: number;
	shuttleProgress?: number;
	activeTriggerTags: MapTriggerTag[];
	participantMode: boolean;
	motionEnabled: boolean;
};

export type RouteGuideContent = {
	title: string;
	body: string;
	items: string[];
};

export type RideCopy = {
	eyebrow: string;
	title: string;
	body: string;
};

export type DetailAction = {
	topic: DetailTopic;
	label: string;
	icon: IconName;
	source: string;
};

export type MetricItem = {
	icon: IconName;
	value: string;
	label: string;
	changeLabel?: string;
	detailLabel?: string;
	tone?: 'neutral' | 'delay' | 'early';
};

export type BookingOptionView = {
	option: RideOption;
	waitMinutes: number;
	arrivalTime: string;
	comparisonReason: string;
	isSelected: boolean;
	isRecommended: boolean;
};

export const journeySteps: JourneyStep[] = [
	{ key: 'assignment', label: 'Assign' },
	{ key: 'waiting', label: 'Reach' },
	{ key: 'delay', label: 'Waiting' },
	{ key: 'near_arrival', label: 'Arriving' }
];
