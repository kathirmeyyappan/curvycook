import asyncio

from game_schedule import GameSchedule, decision_period


class BrowserGame:
    def __init__(self, simulator, policies, decision_windows, human_seat=None):
        self.simulator = simulator
        self.policies = tuple(policies)
        self.decision_windows = tuple(decision_windows)
        self.human_seat = human_seat
        self.actions = [1] * len(self.policies)
        period = decision_period(self.decision_windows)
        self.schedule = GameSchedule(
            self,
            period=period,
            quantum=1,
        )
        self.frame = None

    @property
    def tick(self):
        return self.schedule.tick

    def reset(self, seed):
        self.actions[:] = [1] * len(self.actions)
        self.schedule.reset()
        for policy in self.policies:
            if policy:
                policy.reset()
        self.frame = self.simulator.reset(str(seed))
        return self.frame

    def begin_decision(self, **_kwargs):
        self.simulator.beginDecision()

    async def decide(self, tick, **_kwargs):
        for player, (policy, window) in enumerate(
            zip(self.policies, self.decision_windows)
        ):
            if not policy or tick % window:
                continue
            # Checkpoint policies consume the simulator's feature vector; the
            # bot reads the raw state itself and skips the (costly) observe.
            features = self.simulator.observe(player) if getattr(policy, "observe", True) else None
            self.actions[player] = int(await policy.decide(features))

    def override_actions(self, actions):
        for player, action in enumerate(actions):
            if action is not None:
                self.actions[player] = int(action)

    def advance_simulator(self, ticks, *, rollout_limit):
        del rollout_limit
        if ticks != 1:
            raise ValueError("browser simulator advances one tick at a time")
        for player, action in enumerate(self.actions):
            self.simulator.setAction(player, action)
        self.frame = self.simulator.advance()
        return self.frame

    async def advance(self, human_action):
        external_actions = [None] * len(self.actions)
        if self.human_seat is not None:
            external_actions[self.human_seat] = human_action
        return await self.schedule.advance_async(
            external_actions=external_actions,
        )

    async def run(self, controls, emit, tick_hz):
        next_tick_at = controls.now()
        while controls.running():
            frame = await self.advance(controls.action())
            emit(frame)
            if frame.done:
                return frame
            next_tick_at += 1.0 / tick_hz
            await asyncio.sleep(max(0.0, next_tick_at - controls.now()))
        return self.frame
