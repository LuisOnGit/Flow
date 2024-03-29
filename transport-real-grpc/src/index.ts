/* eslint-disable func-style */
// @ts-expect-error
import { send as grpcSend } from '@onflow/transport-grpc';
import * as grpc from '@grpc/grpc-js';
import assert from 'node:assert';
import { isArray, isString } from 'lodash';
import LRU from 'lru-cache';
import type { ChannelOptions } from '@grpc/grpc-js/src/channel-options';

function getErrorStackString(error: Error): string {
    return error.stack?.split('\n').slice(1).join('\n') ?? '<>';
}
function callErrorFromStatus(error: any, callerStack: string, node: string): Error {
    const stringError = isString(error);
    const stack = stringError ? callerStack : `${error.stack}\nfor call at\n${callerStack}`;
    return Object.assign(stringError ? new Error(error) : error, { stack, node });
}

const grpcClients = new LRU({
    max: 500,

    ttl: 15 * 60 * 1000,
    ttlResolution: 10_000,

    allowStale: false,
    updateAgeOnGet: true,
    noDeleteOnStaleGet: false,
});
let roundRobin = 0;

export const defaultGrpcOptions: ChannelOptions = {
    'grpc.http2.max_pings_without_data': 10,
    'grpc.keepalive_time_ms': 30_000,
    'grpc.keepalive_timeout_ms': 10_000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.enable_retries': 1,
    'grpc.max_connection_idle_ms': 15 * 60 * 1000,
};

async function grpcClientWaitReady(grpcClient: grpc.Client, timeout = 10_000) {
    return new Promise<void>((resolve, reject) => {
        const deadline = new Date(Date.now() + timeout);
        grpcClient.waitForReady(deadline, (err: Error | undefined) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

const nodeTokens = new Map<string, string>();

const getSubdomain = (url: string) => {
    let domain = url;
    if (url.includes('://')) {
        domain = url.split('://')[1];
    }
    return domain.split('.')[0];
};

// QuickNode credentials TODO other auth methods?
function getCredentials(
    node: string,
    token: string | undefined,
    secure: boolean,
): grpc.ChannelCredentials {
    if (!token) {
        return secure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
    }

    const serialized = `${encodeURIComponent(getSubdomain(node))}:${encodeURIComponent(token)}`;
    const secureCred = grpc.credentials.createSsl();
    const metaCreds = grpc.credentials.createFromMetadataGenerator((_params, callback) => {
        const meta = new grpc.Metadata();
        meta.add('authorization', `Basic ${Buffer.from(serialized).toString('base64')}`);
        callback(null, meta);
    });
    return grpc.credentials.combineChannelCredentials(secureCred, metaCreds);
}

// Patch unary to use proper grpc
export async function send(ix: any, context: any, opts: any = {}) {
    assert(
        opts.node,
        `SDK Send Error: Either opts.node or "accessNode.api" in config must be defined.`,
    );
    assert(context.ix, `SDK Send Error: context.ix must be defined.`);

    let node = opts.node;
    const nodeToken = opts.nodeToken ?? (await context.config().get('nodeToken'));
    const nodeSecure = opts.nodeSecure ?? Boolean(nodeToken);
    const grpcOptions = (opts.grpcOptions ?? {}) as ChannelOptions;
    const grpcMetadata = opts.gprcMetadata ?? {};
    const serviceName = opts.grpcServiceName;
    if (isArray(node)) node = node[roundRobin++ % node.length];
    if (roundRobin > 1000) roundRobin = 0;

    // eslint-disable-next-line unicorn/error-message
    const callerStackError = new Error();
    try {
        if (node.toLowerCase().startsWith('grpc://')) {
            node = node.slice(7);
        }
        if (node.toLowerCase().startsWith('http')) {
            return await grpcSend(ix, context, { ...opts, node });
        }
        return await grpcSend(ix, context, {
            unary: async (host: string, method: any, request: any, context: any) => {
                if (nodeToken && nodeTokens.get(node) !== nodeToken) {
                    grpcClients.delete(host);
                    nodeTokens.set(node, nodeToken);
                }
                let grpcClient = grpcClients.get<grpc.Client>(host);
                if (!grpcClient) {
                    grpcClient = new grpc.Client(
                        host,
                        getCredentials(node, nodeToken, nodeSecure),
                        {
                            ...defaultGrpcOptions,
                            ...grpcOptions,
                        },
                    );
                    grpcClients.set(host, grpcClient);
                }
                await grpcClientWaitReady(grpcClient);
                // eslint-disable-next-line no-async-promise-executor
                return await new Promise(async (resolve, reject) => {
                    try {
                        const metadataFromConfig = await context.config().get('grpc.metadata', {});
                        grpcClient!.makeUnaryRequest(
                            `/${serviceName ?? method.service.serviceName}/${method.methodName}`,
                            () => Buffer.from(request.serializeBinary()),
                            (value) => {
                                return method.responseType.deserializeBinary(value);
                            },
                            request,
                            grpc.Metadata.fromHttp2Headers({
                                ...metadataFromConfig,
                                ...grpcMetadata,
                            }),
                            (err, result) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    resolve(result);
                                }
                            },
                        );
                    } catch (err) {
                        reject(err);
                    }
                });
            },
            ...opts,
            node,
        });
    } catch (err) {
        throw callErrorFromStatus(err, getErrorStackString(callerStackError), node);
    }
}
