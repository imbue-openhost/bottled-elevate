import os
from pathlib import Path

from playwright.sync_api import expect
from playwright.sync_api import sync_playwright

# Set ELEVATE_TEST_SHOTS_DIR to also capture screenshots of each step.
_SHOTS_DIR = os.environ.get("ELEVATE_TEST_SHOTS_DIR")


def _shot(page, name: str, locator=None) -> None:
    if not _SHOTS_DIR:
        return
    Path(_SHOTS_DIR).mkdir(parents=True, exist_ok=True)
    # The app scrolls inside mat-sidenav-content, so full-page shots only show the
    # viewport; element shots scroll their target into view and capture it whole.
    if locator is None:
        page.screenshot(path=f"{_SHOTS_DIR}/{name}.png", full_page=True)
    else:
        locator.screenshot(path=f"{_SHOTS_DIR}/{name}.png")


def test_compare_view(stack):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1500, "height": 1100})
        try:
            _run(stack, page)
        except Exception:
            _shot(page, "99-failure")
            raise
        finally:
            browser.close()


def _run(stack, page):
    stack.playwright_login(page)
    page.goto(stack.url)

    # The app auto-starts the initial sync; the 3 mock workouts land in the table.
    page.wait_for_selector("mat-row", timeout=120000)
    expect(page.locator("mat-row")).to_have_count(3, timeout=30000)
    _shot(page, "01-activities")

    # Tick all compare checkboxes; the compare bar appears.
    checkboxes = page.locator("mat-row mat-checkbox")
    for i in range(3):
        checkboxes.nth(i).click()
    expect(page.locator(".compare-bar")).to_contain_text("3 selected")
    _shot(page, "02-selected")

    page.locator(".compare-bar button", has_text="Compare").click()
    page.wait_for_selector("app-activity-compare", timeout=30000)
    assert "/activity/compare/" in page.url

    # Header legend: one colored chip per workout.
    expect(page.locator(".workout-chip")).to_have_count(3, timeout=30000)

    # Map section is present (tiles need a mapbox token, so the fallback note is fine).
    expect(page.locator("app-compare-map")).to_have_count(1)

    # Stacked analysis graphs: one chart per sensor, workouts overlaid as traces.
    page.wait_for_selector("app-compare-graph-chart .js-plotly-plot", timeout=30000)
    graph_count = page.locator("app-compare-graph-chart").count()
    assert graph_count >= 3  # at least elevation + pace/speed + heart rate

    # All 3 workouts share elevation + HR streams, so some chart overlays 3 traces.
    max_traces = page.evaluate(
        """() => Math.max(...Array.from(
                 document.querySelectorAll('app-compare-graph-chart .js-plotly-plot')
               ).map(el => (el.data || []).length))"""
    )
    assert max_traces == 3

    # The ride is alone on the power chart: some chart has exactly 1 trace.
    trace_counts = page.evaluate(
        """() => Array.from(
                 document.querySelectorAll('app-compare-graph-chart .js-plotly-plot')
               ).map(el => (el.data || []).length)"""
    )
    assert 1 in trace_counts
    _shot(page, "03-compare-graphs", page.locator(".graphs-stack"))

    # Stats tab (default): mini per-stat charts, grouped like the classic stats page.
    page.wait_for_selector("app-compare-stat-chart .js-plotly-plot", timeout=30000)
    assert page.locator("app-compare-stat-chart").count() >= 5
    _shot(page, "04-compare-stats", page.locator(".stat-display-group").first)

    # Peaks tab: overlaid peaks curves per sensor.
    page.locator(".mat-tab-label", has_text="Peaks").click()
    page.wait_for_selector("app-compare-peak-chart .js-plotly-plot", timeout=30000)
    assert page.locator("app-compare-peak-chart").count() >= 2
    peak_traces = page.evaluate(
        """() => Math.max(...Array.from(
                 document.querySelectorAll('app-compare-peak-chart .js-plotly-plot')
               ).map(el => (el.data || []).length))"""
    )
    assert peak_traces == 3  # heart rate peaks exist for all 3 workouts
    _shot(page, "05-compare-peaks", page.locator("mat-tab-group"))

    # Scale toggle re-renders the stack on the other x-axis.
    page.locator(".mat-tab-label", has_text="Stats").click()
    toggle = page.locator("button", has_text="Time scale")
    toggle.wait_for(timeout=10000)
    toggle.click()
    page.wait_for_selector("app-compare-graph-chart .js-plotly-plot", timeout=30000)
    expect(page.locator("button", has_text="Distance scale")).to_be_visible()
    _shot(page, "06-compare-time-scale")
