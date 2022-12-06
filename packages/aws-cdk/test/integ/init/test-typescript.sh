#!/bin/bash
#------------------------------------------------------------------
# setup
#------------------------------------------------------------------
set -eu
scriptdir=$(cd $(dirname $0) && pwd)
integdir=$(dirname $scriptdir)
source ${scriptdir}/common.bash

header TypeScript

#------------------------------------------------------------------

if [[ "${1:-}" == "" ]]; then
    templates="app sample-app lib"
else
    templates="$@"
fi

MIN_SUPPORTED_TS_VERSION="3.9"
SUPPORTED_TS_VERSIONS=$(node ${integdir}/typescript-versions.js ${MIN_SUPPORTED_TS_VERSION})

for template in $templates; do
    for version in $SUPPORTED_TS_VERSIONS; do
        echo "Trying TypeScript template $template with TS$version"

        setup

        cdk init -l typescript $template
        npm install --save typescript@$version
        npm prune && npm ls # this will fail if we have unmet peer dependencies
        npm run build
        npm run test

        # Can't run `cdk synth` on libraries
        if [[ $template != "lib" ]]; then
            cdk synth
        fi
    done
done
