import re, os, json

with open(r'tests/accessories/reports/allure-report/assets/index-CVsGnucd.js', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Find the Cn function definition and all calls to it
# Cn loads widget json files: Cn = async e => { let t = await zt('widgets/${e}.json')...}
# Pattern: find Cn( with a string argument
cn_calls = re.findall(r'Cn\(["\`]([^"\`]+)["\`]\)', content)
print("Direct Cn() calls with string args:", cn_calls)

# Find wn() calls (creates Cn thunks)
wn_calls = re.findall(r'wn\(["\`]([^"\`]+)["\`]\)', content)
print("Direct wn() calls:", wn_calls)

print()

# Find ALL string literals adjacent to widget loading context
# Look for the overview tab widget list — it's an array of widget config objects
# In Allure 2.x, this looks like: [{type:'summary',id:'summary'}, ...]
widget_cfgs = re.findall(r'type:["\`]([\w\-]+)["\`]', content)
print("type: string occurrences (first 30):", list(set(widget_cfgs))[:30])

print()

# Look for widget registry / widget map
# In Allure2 new bundle these look like: {"summary":..., "history-trend":...}
obj_keys = re.findall(r'["\`](summary|history\-trend|categories\-trend|duration\-trend|retry\-trend|severity|status\-chart|duration|suites|environment|categories|executors|launch|behaviors|packages|timeline)["\`]', content)
print("Known widget name occurrences:")
from collections import Counter
for name, cnt in sorted(Counter(obj_keys).items(), key=lambda x: -x[1]):
    print(f"  {name:30s} {cnt}x")

print()

# Check what widget files exist vs what's mentioned
widgets_dir = r'tests/accessories/reports/allure-report/widgets'
existing = set(os.listdir(widgets_dir))
mentioned = set(obj_keys)
print("Mentioned but NOT in widgets/:")
for m in sorted(mentioned):
    fname = f"{m}.json"
    if fname not in existing:
        print(f"  MISSING: {fname}")
