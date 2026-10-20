def decision_period(windows):
    windows = tuple(windows)
    period = max(windows)
    if any(period % window for window in windows):
        raise ValueError("decision windows must divide the largest window")
    return period


class GameOperation:
    async def execute_async(self, backend):
        return self.execute(backend)


class BeginDecision(GameOperation):
    __slots__ = ("autoreset", "rollout_limit", "valid", "valid_index")
    autoreset: bool
    rollout_limit: int | None
    valid: object | None
    valid_index: int

    def __init__(
        self,
        autoreset: bool,
        rollout_limit: int | None,
        valid: object | None,
        valid_index: int,
    ):
        self.autoreset = autoreset
        self.rollout_limit = rollout_limit
        self.valid = valid
        self.valid_index = valid_index

    def execute(self, backend):
        return backend.begin_decision(
            autoreset=self.autoreset,
            rollout_limit=self.rollout_limit,
            valid=self.valid,
            valid_index=self.valid_index,
        )


class Decide(GameOperation):
    __slots__ = ("sample", "seeds", "step", "tick")
    tick: int
    step: int
    seeds: object | None
    sample: object | None

    def __init__(
        self,
        tick: int,
        step: int,
        seeds: object | None,
        sample: object | None,
    ):
        self.tick = tick
        self.step = step
        self.seeds = seeds
        self.sample = sample

    def execute(self, backend):
        return backend.decide(
            self.tick,
            step=self.step,
            seeds=self.seeds,
            sample=self.sample,
        )

    async def execute_async(self, backend):
        return await self.execute(backend)


class OverrideActions(GameOperation):
    __slots__ = ("actions",)
    actions: object

    def __init__(self, actions: object):
        self.actions = actions

    def execute(self, backend):
        return backend.override_actions(self.actions)


class AdvanceSimulation(GameOperation):
    __slots__ = ("rollout_limit", "ticks")
    ticks: int
    rollout_limit: int | None

    def __init__(self, ticks: int, rollout_limit: int | None):
        self.ticks = ticks
        self.rollout_limit = rollout_limit

    def execute(self, backend):
        return backend.advance_simulator(
            self.ticks,
            rollout_limit=self.rollout_limit,
        )


class GameSchedule:
    def __init__(
        self,
        backend,
        *,
        period: int,
        quantum: int,
        autoreset: bool = False,
        rollout_limit: int | None = None,
    ):
        self.backend = backend
        self.period = period
        self.quantum = quantum
        self.autoreset = autoreset
        self.rollout_limit = rollout_limit
        self.tick = 0

    def reset(self):
        self.tick = 0

    def advance(
        self,
        ticks=1,
        *,
        tick=None,
        decision_step=0,
        seeds=None,
        sample=None,
        external_actions=None,
        valid=None,
        valid_index=0,
    ):
        return self._execute(
            self._operations(
                ticks,
                tick=tick,
                decision_step=decision_step,
                seeds=seeds,
                sample=sample,
                external_actions=external_actions,
                valid=valid,
                valid_index=valid_index,
            )
        )

    async def advance_async(
        self,
        ticks=1,
        *,
        tick=None,
        decision_step=0,
        seeds=None,
        sample=None,
        external_actions=None,
        valid=None,
        valid_index=0,
    ):
        return await self._execute_async(
            self._operations(
                ticks,
                tick=tick,
                decision_step=decision_step,
                seeds=seeds,
                sample=sample,
                external_actions=external_actions,
                valid=valid,
                valid_index=valid_index,
            )
        )

    def _operations(
        self,
        ticks,
        *,
        tick,
        decision_step,
        seeds,
        sample,
        external_actions,
        valid,
        valid_index,
    ):
        if ticks <= 0:
            raise ValueError("game-loop advances require at least one tick")
        if external_actions is not None and ticks != 1:
            raise ValueError("external action overrides require one-tick advances")

        explicit_tick = tick is not None
        cursor = self.tick if tick is None else tick
        stop = cursor + ticks
        while cursor < stop:
            if cursor % self.period == 0:
                yield BeginDecision(
                    self.autoreset,
                    self.rollout_limit,
                    valid,
                    valid_index,
                )
            yield Decide(cursor, decision_step, seeds, sample)
            if external_actions is not None:
                yield OverrideActions(external_actions)
            phase = cursor % self.quantum
            chunk = min(self.quantum - phase, stop - cursor)
            limit = self.rollout_limit if cursor + chunk == stop else None
            yield AdvanceSimulation(chunk, limit)
            cursor += chunk
        if not explicit_tick:
            self.tick = cursor

    def _execute(self, operations):
        result = None
        for operation in operations:
            result = operation.execute(self.backend)
        return result

    async def _execute_async(self, operations):
        result = None
        for operation in operations:
            result = await operation.execute_async(self.backend)
        return result
