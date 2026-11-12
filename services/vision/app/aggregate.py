from statistics import median


class Window:
    """Junta los conteos de una ventana de tiempo y reporta la mediana, que aguanta los parpadeos del detector."""

    def __init__(self, seconds: float):
        self.seconds = seconds
        self.samples: list[int] = []
        self.start: float | None = None

    def add(self, count: int, now: float) -> None:
        if self.start is None:
            self.start = now
        self.samples.append(count)

    def due(self, now: float) -> bool:
        return self.start is not None and now - self.start >= self.seconds

    def flush(self) -> int | None:
        if not self.samples:
            return None
        out = round(median(self.samples))
        self.samples, self.start = [], None
        return out
