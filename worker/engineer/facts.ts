/**
 * Grounding cards for the Race Engineer prompt (ARCHITECTURE §12.5 step 2). Curated from research 04 §1-§11 and
 * checked against what THIS simulation measures (02-02 kinematics report, 02-04 difference report, 02-05 geometry).
 * tests/worker/engineer-facts.test.ts pins every comparative claim to the ordering sim-core produces.
 * RULES: no digits (numbers come only from telemetry; tests assert it); tendencies are worded as such; every card
 * says what the model does not capture. Research estimates ([E]) are never stated as data.
 */

const AUTO_INTRO = `The car is a self-driving GT coupe with representative parameters, not the data of any real car. It laps a test loop on a fixed path at the same speed whatever the suspension.`;
const SHARED = `All three suspension types share the same springs, dampers, anti-roll bars, tyres and ride frequencies, so differences come only from the linkage geometry, plus a little extra damper friction for the strut.`;
const SIGNS = `Signs: negative camber means the top of the wheel leans toward the car; camber is measured to the road. Bump means the wheel is pushed up and the spring compressed. In a right-hand corner the body leans to the left and the left wheels are the outside, loaded wheels; in a left-hand corner it is the opposite.`;
const GRIP_USE = `Grip use is a simplified tyre-model estimate of how much of the available grip a tyre uses (around one means at the limit), not a measurement.`;
const DEFINITIONS = `Roll-centre heights are live kinematic values. Camber gain is the camber change relative to the body per centimetre of bump at design height. Wheel lean per degree of body roll is one when the wheel leans fully with the body and zero when it stays upright to the road. Anti-dive and anti-squat are side-view anti-pitch percentages.`;
const ROLL_PHYSICS = `Physics: in a corner, load moves to the outside tyres. The roll centre splits that load transfer: the part carried through the links does not roll the body, the part carried by springs and bars does. A higher roll centre gives slightly less roll but more jacking and more sideways movement of the roll centre. Body roll grows with lateral acceleration, so the car leans most in the hardest steady corner, the carousel; roll-centre height changes the roll only a little, and in this simulation the strut, with the highest roll centre, rolls slightly the least and the multi-link slightly the most.`;
const CAMBER_SUM = `The outside wheel's camber to the road is roughly its static camber, plus the camber the linkage adds in bump, plus the body roll. A linkage that adds negative camber in bump counters the roll and keeps the tyre flatter.`;
const STEER_CAMBER = `Steering also changes camber: with caster, the outside front wheel gains negative camber as it steers, so at the front the steering geometry matters as much as the linkage.`;
const AUTO_VISIBILITY = `In this simulation the three types differ visibly in roll-centre height and in outside-rear camber in long corners. Differences in outside-front camber are small, and differences in body roll, brake pitch, bump steer and grip use are tiny. The screen can amplify motion (it says so when it does); numbers are always true scale.`;
const AUTO_NOT_MODELLED = `Not modelled: bushing compliance and flexing parts (all links are rigid), tyre temperature, wear and pressure, aerodynamic downforce, the extra vertical load from the banking in the carousel, and rear anti-lift under braking.`;
const NO_BEST = `No suspension type is best overall; each trades cost, packaging and wheel control.`;

export const COMMON_CAR = [AUTO_INTRO, SHARED, SIGNS, GRIP_USE, DEFINITIONS, ROLL_PHYSICS, CAMBER_SUM, STEER_CAMBER, AUTO_VISIBILITY, AUTO_NOT_MODELLED, NO_BEST].join('\n');

export const COMMON_MOTORCYCLE = `The motorcycle is a self-driving cafe racer with representative parameters, not the data of any real bike. It leans into corners; roll_deg is its lean angle. Corners: f front, r rear.
Typical tendencies: a telescopic fork compresses under braking, so the front dives and the steering geometry tightens; a Telelever front separates braking forces from the spring, so it dives much less; a linkage rear suspension usually stiffens progressively deeper into its travel; a twin-shock rear is simpler and lighter in parts.
The motorcycle presets use different springs and dampers as well as different mechanisms; their responses are not a geometry-only comparison.
Not modelled: frame and fork flex, tyre temperature and wear, rider body movement and aerodynamics.
No layout is best overall; each trades cost, weight, feel and control.`;

/** Per suspension id. Cards for ids without an entry fall back to the common card only. */
export const SUSPENSION_FACTS: Readonly<Record<string, string>> = {
  macpherson: `ACTIVE SUSPENSION: MacPherson strut. A lower arm plus a strut whose damper body is a structural part that slides through a top mount; the steering axis runs from the lower ball joint to the top mount.
It adds the least camber in bump of the three types here, so in roll the wheels lean almost as much as the body.
It has the highest roll centre of the three here, and that roll centre moves a long way as the car rolls and heaves.
In this simulation the strut front has the most caster, so steering adds negative camber to the outside front wheel; in the carousel that offsets its weak camber gain, and its outside front ends up close to the multi-link. Its rear, which does not steer, loses clearly the most outside camber of the three in long corners.
Side load on the strut adds friction, which typically makes small bumps a little harsher; in this simulation the effect is small.
Its side-view geometry gives it the most anti-dive here, but brake pitch differs only a tiny amount between the types.
Strengths: typically the fewest parts, the lowest cost, compact across the car (room for the engine), light. Costs: a tall tower that raises the bonnet line, limited camber control, and it is harder to combine wide tyres with a small scrub radius.`,
  'double-wishbone': `ACTIVE SUSPENSION: double wishbone. Two arms of unequal length (the upper one shorter) hold the upright; the steering axis runs between the two ball joints, independent of the spring and damper.
It adds the most negative camber in bump of the three types here: as the body rolls it pulls the top of the outside wheel inward, so the tyre stays the flattest. The gain over the others is clearest at the rear in long corners; at the front, at true scale, it is small.
Its roll centre is in the middle of the three here, and as the body rolls it moves sideways much less than the strut's, but more than the multi-link's.
The spring and damper work in line with the motion, so friction is low.
Strengths: typically close control of camber and a low bonnet line. Costs: more parts and cost, and a wider package. Over bumps its tyre scrubs sideways more than the multi-link's, though less than the strut's here.`,
  multilink: `ACTIVE SUSPENSION: multi-link. Here five separate rods locate each wheel, and the steering axis is a virtual one defined by the links.
Its camber gain in bump and its camber recovery in roll lie between the strut and the double wishbone here.
It has the lowest roll centre of the three here, so slightly more of the load transfer goes through the springs and the body rolls a tiny bit more. In this layout its roll centre moves sideways the least of the three as the body rolls, because its lower links sit close to horizontal across the car.
Its main real-world advantage is control of toe and camber under cornering and braking forces through deliberately designed bushing compliance. This simulation uses rigid links, so that advantage is not modelled and does not show; all three types were tuned to almost no bump steer.
Strengths: typically the most freedom to tune camber, toe and anti-dive or anti-squat independently, and good isolation. Costs: the most parts, cost and tuning effort.`,
};

/** Representative layouts from the motorcycle content definitions, separate from the car's active cards. */
export const MOTORCYCLE_SUSPENSION_FACTS: Readonly<Record<string, string>> = {
  'moto-classic': `ACTIVE SUSPENSION: Klasik motorcycle preset. A right-way-up telescopic fork guides the front wheel, with the springs and dampers working along the fork axis.
Under braking the fork compresses, reducing the front ride height and changing rake and trail. Sliding friction can delay its first movement over small bumps.
The rear is a conventional swingarm with twin direct-acting shocks. Its geometry is nearly linear; a dual-rate spring changes stiffness deeper in travel.
Typical trade-offs are simple construction and maintenance against brake dive and sliding friction. These are representative settings; fork and frame flex are not modelled.`,
  'moto-modern': `ACTIVE SUSPENSION: Modern motorcycle preset. An inverted telescopic fork guides the front wheel; it shares the Classic preset's steering geometry and still dives under braking.
The rear swingarm drives a monoshock through a rocker and linkage. The changing motion ratio makes the rear progressively stiffer deeper into travel, even though the shock spring itself is linear.
Typical trade-offs are control of the rear motion ratio and central shock placement against extra joints, bearings and packaging space. An inverted fork can be stiffer in real construction, but fork flex is not modelled here and is not evidence of extra grip.`,
  'moto-telelever': `ACTIVE SUSPENSION: Telelever motorcycle preset. A front locating arm and joint determine the wheel path; the fork tubes steer and guide, while the spring and damper act on the arm.
The arm geometry sets anti-dive rather than an assigned anti-dive constant. It opposes brake dive and preserves steering geometry more than the telescopic layouts; the front wheel path can increase trail as the suspension compresses.
The rear is a single-sided swingarm with a direct-acting monoshock, without the Modern preset's rocker linkage.
Typical trade-offs are less brake dive and less spring loading through the fork tubes against extra front-end parts, different brake feel and a wheel path that can feel harsher on sharp edges. These are representative mechanisms, not specifications for a production motorcycle.`,
};

// ---------------------------------------------------------------- Manual Drive (12-03)
// While the visitor drives, the plant (09-01..09-04) adds tyre slip, compliance, powertrain and assists to the same
// geometry. Every comparative claim below is pinned by tests/worker/engineer-drive-facts.test.ts to sim-core runs
// (09-04 honesty report fixtures). Digit-free like the Auto cards.

const DRIVE_INTRO = `The visitor is driving the GT coupe themselves through a representative vehicle model (not the data of any real car): tyres that slip, a rear-wheel-drive engine and automatic gearbox, brakes and simplified assists. Driving events are found by detectors in the simulator; the engineer only explains what they detected.`;
const DRIVE_SHARED = `All three suspension types share the same springs, dampers, anti-roll bars, tyres, bushing table, engine and brakes, so differences come only from the linkage geometry and the compliance that geometry gives the shared bushings.`;
const DRIVE_PHYSICS = `Tyre grip grows with the load on the tyre but less than in proportion: twice the load gives less than twice the grip, so moving load from one tyre to another costs the pair a little grip. A tyre also has to share its grip between braking or driving and cornering.
Braking moves load onto the front tyres and off the rear; accelerating does the opposite; cornering moves load onto the outside tyres. The anti-roll bars split the cornering share between the front and the rear.
Understeer: the front tyres reach their limit first and the car runs wide, so more steering does not help (the detector calls it a front slide). Oversteer: the rear tyres reach their limit first and the tail steps out (a rear slide); past a large sideslip the car spins.
Lifting off the throttle mid-corner moves load forward: the front tyres gain grip and the rear lose some, so the car turns in a little more; near the limit the lighter rear can slide and the car rotates (lift-off oversteer). Well below the limit a lift changes the line only a little.
A wheel that is braked harder than its tyre can take stops turning and locks; a sliding tyre cannot steer. The anti-lock assist eases the brake on a wheel that is about to lock, so it keeps turning and the car can still steer; in this model it also stops a little shorter than with locked wheels.
Too much throttle spins the driven rear wheels. The traction assist trims the engine to hold them near their best slip; without the assists, full throttle in a corner can swing the tail out. The stability assist brakes a single wheel when the car rotates more or less than the steering asks.
Braking with the wheels of one side on a slippery surface turns the car toward the side with more grip, because the grippier side brakes harder; without steering against it, the assists alone cannot hold the car straight.
Compliance: while you drive, tyre forces bend the rubber bushings a little, which changes toe and camber. Under cornering load the outside rear wheel toes in and the inside rear wheel toes out, so the rear wheels steer slightly into the turn, which steadies the car toward understeer; braking in a corner adds a little more. The multi-link rear does this most, about three times as much as the strut or the double wishbone: that is the multi-link's compliance steer in this model. In Auto the links are rigid.
Kerb and bump strikes compress one spring quickly; a wheel that goes light has almost no grip; a bump-stop hit means the wheel used up its travel.
Launch and stopping: how quickly the car reaches motorway speed and how far it needs to stop are outputs of this representative model with its generic tyres, not predictions for any real car; the launch is limited by rear-tyre grip.
All assists are simplified models, not any manufacturer's system. Surface grip is approximate. Beyond a large sideslip or at the grip limit the model is approximate.`;
const DRIVE_NOT_MODELLED = `Not modelled: tyre temperature, wear and pressure, aerodynamic downforce, brake fade and frame flex.`;

/** Measured on the same car with the same scripted inputs per type (09-04 honesty report, 11-04 ghost runs). */
export const DRIVE_COMPARE = `MEASURED DIFFERENCES WHILE DRIVING (same car, same inputs): the strut and the double wishbone drive almost the same in this model: the steering needed, the response and the calmness differ by less than a driver can notice; their linkages move differently but the feel hardly changes.
The multi-link car needs noticeably more steering for the same corner (more understeer), turns in a little quicker with a little more overshoot, and stays calmer in a quick lane change and when braking in a corner, because its rear compliance steers the rear wheels into the turn.
The cornering grip limit, the stopping distance and the launch are almost the same for all three, because they are set by the shared tyres.
The Compare ghost replays the visitor's own drive on another suspension with a disclosed autopilot and reports only differences larger than its own repeat error; strut against double wishbone usually comes out the same, strut against multi-link usually needs more steering.
No type is best: the multi-link trades a heavier, more planted feel for needing more steering.`;

export const DRIVE_COMMON = [DRIVE_INTRO, DRIVE_SHARED, SIGNS, GRIP_USE, DRIVE_PHYSICS, CAMBER_SUM, DRIVE_NOT_MODELLED, NO_BEST].join('\n');

/** The multi-link card's Auto-only sentence (rigid links) and its driving replacement. */
const ML_AUTO = 'This simulation uses rigid links, so that advantage is not modelled and does not show; all three types were tuned to almost no bump steer.';
const ML_DRIVE = 'While the visitor drives, this model includes that compliance (see the compliance fact); all three types were tuned to almost no bump steer.';

export function factsFor(vehicleClass: string, suspension: string, driving = false): string {
  if (vehicleClass === 'motorcycle') {
    const card = MOTORCYCLE_SUSPENSION_FACTS[suspension];
    return card ? `${COMMON_MOTORCYCLE}\n${card}` : COMMON_MOTORCYCLE;
  }
  if (vehicleClass !== 'car') return 'Unknown vehicle class; no suspension grounding is available.';
  if (driving) {
    const card = SUSPENSION_FACTS[suspension]?.replace(ML_AUTO, ML_DRIVE);
    return [DRIVE_COMMON, DRIVE_COMPARE, ...(card ? [card] : [])].join('\n');
  }
  const card = SUSPENSION_FACTS[suspension];
  return card ? `${COMMON_CAR}\n${card}` : COMMON_CAR;
}
