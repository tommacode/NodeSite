!#/bin/bash

# This script will deploy the latest version of the application to the server
# It will also restart the application

killall node backend.js
rm -r NodeSite
git clone https://github.com/tommacode/NodeSite
cd NodeSite
nohup node backend.js