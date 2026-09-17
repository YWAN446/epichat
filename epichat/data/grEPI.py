import requests
import json
import pandas as pd
from collections import Counter 


resp = requests.get("https://collaboratory.who.int/grepi/api/EpiParameterEstimates")
df = pd.DataFrame(resp.json())

print(df["disease"].value_counts().to_string())


resp = requests.get(
    "https://collaboratory.who.int/grepi/api/EpiParameterEstimates",
    params={"disease": "Measles"}
)

data = resp.json()

# See the top-level structure
print(type(data))          # list or dict?
print(len(data))           # how many records?

# Inspect the first record's keys
print(json.dumps(data[0], indent=2))

print("Second record:")
print(json.dumps(data[1], indent=2))

types = [r.get("parameter_type") for r in data if r.get("parameter_type")]
print(f"Unique parameter types ({len(set(types))}):")
for val, count in Counter(types).most_common():
    print(f"  {count:4d}  {val}") 