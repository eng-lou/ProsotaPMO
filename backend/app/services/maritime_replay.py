"""Compact, calculation-owned replay tracks; no rendering or invented movements.

Adjacent minutes with the same state/rate are a single segment. The bounded
fallback samples quantities but deliberately drops per-asset playback when a
pathological input exceeds the trace budget, rather than storing a partial trace.
"""

MAX_SEGMENTS = 50000


class ReplayRecorder:
    def __init__(self):
        self.tracks = {}
        self.count = 0
        self.exceeded = False

    def add(self, key, start, end, value, rate, state, reason='', call_id=None):
        if self.exceeded:
            return
        rate = round(rate, 8)
        signature = (rate, state, reason, str(call_id) if call_id else None)
        rows = self.tracks.setdefault(str(key), [])
        if (rows and rows[-1]['signature'] == signature and rows[-1]['end'] == start
                and abs(rows[-1]['value'] + rate * (start - rows[-1]['start']) - value) < 1e-5):
            rows[-1]['end'] = end
        else:
            rows.append({'start': start, 'end': end, 'value': round(value, 8),
                         'rate': rate, 'state': state, 'reason': reason,
                         'call_id': signature[3], 'signature': signature})
            self.count += 1
            if self.count > MAX_SEGMENTS:
                self.exceeded = True
                self.tracks.clear()

    def result(self):
        return {'version': 1, 'available': not self.exceeded,
                'tracks': {key: [{k: v for k, v in row.items() if k != 'signature'} for row in rows]
                           for key, rows in self.tracks.items()},
                'note': 'Replay detail limit reached; aggregate results remain available.' if self.exceeded else
                        'Equipment motion represents calculated handling progress. Travel paths are illustrative.'}
