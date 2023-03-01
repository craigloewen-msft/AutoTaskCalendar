#!/bin/bash

# Read the current version from the HTML file
current_version=$(grep -oP 'AutoTaskCalendar v\K[\d.]+' ./webinterface/public/index.html)

# Increment the version by 0.1
new_version=$(echo "$current_version + 0.1" | bc)

# Update the HTML file with the new version
sed -i "s/$current_version/$new_version/" ./webinterface/public/index.html

# Print the new version number
echo "New version: $new_version"
