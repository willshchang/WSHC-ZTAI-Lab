#!/bin/bash
# ============================================================
# HR DATA PIPELINE (ETL)
# ============================================================
# Run this script before terraform apply. It takes raw HR exports
# from the incoming/ dropzone, sanitizes them, and stages them 
# safely in the data/ folder for Terraform to consume.

echo "Starting DDG HR Data Pipeline..."

# [1. EXTRACT] - Safely locate the files in the dropzone
EMP_FILE=$(find incoming/ -iname "*employee*.csv" | head -n 1)
TEAM_FILE=$(find incoming/ -iname "*team*.csv" | head -n 1)

# Safety Gate
if [ -z "$EMP_FILE" ] || [ -z "$TEAM_FILE" ]; then
  echo "❌ Error: Missing files."
  echo "Please place BOTH the employee and team CSVs in the incoming/ folder."
  exit 1
fi

echo "Files located. Moving to staging..."
cp "$EMP_FILE" data/employees.csv
cp "$TEAM_FILE" data/teams.csv

# [2. TRANSFORM] - Sanitize the data
echo "Sanitizing file encodings and headers..."

sed -i 's/^\xEF\xBB\xBF//' data/employees.csv
sed -i 's/^\xEF\xBB\xBF//' data/teams.csv

sed -i '1s/.*/first_name,last_name,team/' data/employees.csv
sed -i '1s/.*/team,applications,role_requirements/' data/teams.csv

# [3. LOAD] - Cleanup
echo "Cleaning up dropzone..."
rm "$EMP_FILE"
rm "$TEAM_FILE"

echo "✅ Data preparation complete! Ready for Terraform."