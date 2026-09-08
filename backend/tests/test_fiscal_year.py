from __future__ import annotations

from datetime import date

from app.services.fiscal_year import (
    fiscal_year_bounds,
    fiscal_year_label,
    fiscal_year_start_year,
    fiscal_years_spanning,
    overlap_days,
)


def test_fiscal_year_start_year_before_and_after_the_6_april_boundary():
    # Maro's own worked example: a project running Sept 2010 to Sept 2014.
    assert fiscal_year_start_year(date(2010, 9, 1)) == 2010  # FY10/11
    assert fiscal_year_start_year(date(2011, 4, 5)) == 2010  # last day of FY10/11
    assert fiscal_year_start_year(date(2011, 4, 6)) == 2011  # first day of FY11/12
    assert fiscal_year_start_year(date(2014, 9, 1)) == 2014  # FY14/15


def test_fiscal_year_label_formats_two_digit_years():
    assert fiscal_year_label(2010) == "FY10/11"
    assert fiscal_year_label(1999) == "FY99/00"


def test_fiscal_year_bounds_span_6_april_to_5_april():
    start, end = fiscal_year_bounds(2010)
    assert start == date(2010, 4, 6)
    assert end == date(2011, 4, 5)


def test_fiscal_years_spanning_sept_2010_to_sept_2014_gives_five_years():
    years = fiscal_years_spanning(date(2010, 9, 1), date(2014, 9, 1))
    assert [fiscal_year_label(y) for y in years] == ["FY10/11", "FY11/12", "FY12/13", "FY13/14", "FY14/15"]


def test_fiscal_years_spanning_empty_when_start_after_end():
    assert fiscal_years_spanning(date(2014, 1, 1), date(2010, 1, 1)) == []


def test_overlap_days_partial_and_full():
    # A 12-Jan-to-20-Jan activity overlapping a fiscal year that starts 6 Apr
    # the year before and ends 5 Apr — no overlap at all.
    assert overlap_days(date(2011, 1, 12), date(2011, 1, 20), date(2010, 4, 6), date(2011, 4, 5)) == 9
    # Fully outside.
    assert overlap_days(date(2012, 1, 1), date(2012, 1, 5), date(2010, 4, 6), date(2011, 4, 5)) == 0
    # Fully inside.
    assert overlap_days(date(2010, 5, 1), date(2010, 5, 10), date(2010, 4, 6), date(2011, 4, 5)) == 10
