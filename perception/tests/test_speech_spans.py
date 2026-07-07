"""Pure-function tests for the silence→speech complement (no ffmpeg — locks the algorithm)."""

from clipforge_perception.ffmpeg import speech_spans_from_silence


def test_two_interior_silences_yield_three_speech_spans():
    # silence at [1,2] and [3,4] within a 5s clip → speech is the complement.
    assert speech_spans_from_silence(5.0, [(1.0, 2.0), (3.0, 4.0)]) == [
        (0.0, 1.0),
        (2.0, 3.0),
        (4.0, 5.0),
    ]


def test_no_silence_is_one_whole_clip_span():
    assert speech_spans_from_silence(5.0, []) == [(0.0, 5.0)]


def test_leading_and_trailing_silence_trimmed():
    # silence at the very start and very end → a single interior speech span.
    assert speech_spans_from_silence(5.0, [(0.0, 1.0), (4.0, 5.0)]) == [(1.0, 4.0)]


def test_silence_spanning_whole_clip_yields_no_speech():
    assert speech_spans_from_silence(5.0, [(0.0, 5.0)]) == []


def test_unsorted_and_overlapping_silences_are_normalized():
    # input order is irrelevant (function sorts) and overlapping silences collapse.
    assert speech_spans_from_silence(6.0, [(3.0, 4.5), (1.0, 2.0), (2.0, 3.5)]) == [
        (0.0, 1.0),
        (4.5, 6.0),
    ]
