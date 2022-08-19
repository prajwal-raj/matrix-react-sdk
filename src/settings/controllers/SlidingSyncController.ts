/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { logger } from "matrix-js-sdk/src/logger";

import SettingController from "./SettingController";
import PlatformPeg from "../../PlatformPeg";
import { SettingLevel } from "../SettingLevel";
import SdkConfig from "../../SdkConfig";
import SettingsStore from "../SettingsStore";
import { MatrixClientPeg } from "../../MatrixClientPeg";

export default class SlidingSyncController extends SettingController {
    public async onChange(level: SettingLevel, roomId: string, newValue: any) {
        if (newValue) {
            // run checks against the "proxy" to make sure it is valid BEFORE we start doing things
            const url = SdkConfig.get().sliding_sync_proxy_url;
            if (!url) {
                logger.error("cannot enable sliding sync without 'sliding_sync_proxy_url' being present");
                return;
            }
            try {
                await proxyHealthCheck(url, MatrixClientPeg.get().baseUrl);
            } catch (err) {
                logger.error("sliding sync proxy not ok: " + err);
                // force the value to false, this is a bit ew, it would be nice if we could return
                // a bool as to whether to go through with the change or not.
                SettingsStore.setValue("feature_sliding_sync", roomId, level, false);
                return;
            }
        }
        PlatformPeg.get().reload();
    }

    public get settingDisabled(): boolean {
        return !SdkConfig.get().sliding_sync_proxy_url;
    }
}

/**
 * Check that the proxy url is in fact a sliding sync proxy endpoint and it is up.
 * @param endpoint The proxy endpoint url
 * @param hsUrl The homeserver url of the logged in user.
 * @throws if the proxy server is unreachable or not configured to the given homeserver
 */
async function proxyHealthCheck(endpoint: string, hsUrl?: string): Promise<any> {
    // TODO: when HSes natively support sliding sync, we should just hit the /sync endpoint to see
    // if it 200 OKs.
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10 * 1000); // 10s
    const res = await fetch(endpoint + "/client/server.json", {
        signal: controller.signal,
    });
    clearTimeout(id);
    if (res.status != 200) {
        throw new Error(`proxyHealthCheck: proxy server returned HTTP ${res.status}`);
    }
    const body = await res.json();
    if (body.server !== hsUrl) {
        throw new Error(`proxyHealthCheck: client using ${hsUrl} but server is as ${body.server}`);
    }
    logger.info("sliding sync proxy is OK");
}