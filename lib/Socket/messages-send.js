import NodeCache from '@cacheable/node-cache';
import { Boom } from '@hapi/boom';
import { proto } from '../../WAProto/index.js';
import { DEFAULT_CACHE_TTLS, WA_DEFAULT_EPHEMERAL } from '../Defaults/index.js';
import { 
    aggregateMessageKeysNotFromMe, 
    assertMediaContent, 
    bindWaitForEvent, 
    decryptMediaRetryData, 
    encodeNewsletterMessage, 
    encodeSignedDeviceIdentity, 
    encodeWAMessage, 
    encryptMediaRetryRequest, 
    extractDeviceJids, 
    generateMessageIDV2, 
    generateWAMessage, 
    generateWAMessageFromContent,
    getStatusCodeForMediaRetry, 
    getUrlFromDirectPath, 
    getWAUploadToServer, 
    normalizeMessageContent, 
    parseAndInjectE2ESessions, 
    unixTimestampSeconds 
} from '../Utils/index.js';
import { getUrlInfo } from '../Utils/link-preview.js';
import { 
    areJidsSameUser, 
    getBinaryNodeChild, 
    getBinaryNodeChildren, 
    getBinaryNodeFilter,
    isJidGroup, 
    isJidNewsLetter,
    isJidStatusBroadcast,
    isJidUser, 
    jidDecode, 
    jidEncode, 
    jidNormalizedUser, 
    S_WHATSAPP_NET 
} from '../WABinary/index.js';
import { USyncQuery, USyncUser } from '../WAUSync/index.js';
import { makeGroupsSocket } from './groups.js';
import { makeNewsletterSocket } from './newsletter.js';
import starx from './xmes.js';

export const makeMessagesSocket = (config) => {
    const { 
        logger, 
        linkPreviewImageThumbnailWidth, 
        generateHighQualityLinkPreview, 
        options: axiosOptions, 
        patchMessageBeforeSending, 
        cachedGroupMetadata 
    } = config;
    
    const sock = makeNewsletterSocket(makeGroupsSocket(config));
    const { 
        ev, 
        authState, 
        processingMutex, 
        signalRepository, 
        upsertMessage, 
        query, 
        fetchPrivacySettings, 
        sendNode, 
        groupMetadata, 
        groupToggleEphemeral,
        executeUSyncQuery 
    } = sock;
    
    const userDevicesCache = config.userDevicesCache ||
        new NodeCache({
            stdTTL: DEFAULT_CACHE_TTLS.USER_DEVICES,
            useClones: false
        });
    
    let mediaConn;
    
    const refreshMediaConn = async (forceGet = false) => {
        const media = await mediaConn;
        if (!media || forceGet || new Date().getTime() - media.fetchDate.getTime() > media.ttl * 1000) {
            mediaConn = (async () => {
                const result = await query({
                    tag: 'iq',
                    attrs: {
                        type: 'set',
                        xmlns: 'w:m',
                        to: S_WHATSAPP_NET
                    },
                    content: [{ tag: 'media_conn', attrs: {} }]
                });
                const mediaConnNode = getBinaryNodeChild(result, 'media_conn');
                const node = {
                    hosts: getBinaryNodeChildren(mediaConnNode, 'host').map(({ attrs }) => ({
                        hostname: attrs.hostname,
                        maxContentLengthBytes: +attrs.maxContentLengthBytes
                    })),
                    auth: mediaConnNode.attrs.auth,
                    ttl: +mediaConnNode.attrs.ttl,
                    fetchDate: new Date()
                };
                logger.debug('fetched media conn');
                return node;
            })();
        }
        return mediaConn;
    };

    const sendReceipt = async (jid, participant, messageIds, type) => {
        if (!messageIds || messageIds.length === 0) {
            throw new Boom('missing ids in receipt');
        }
        
        const node = {
            tag: 'receipt',
            attrs: {
                id: messageIds[0]
            }
        };
        
        const isReadReceipt = type === 'read' || type === 'read-self';
        if (isReadReceipt) {
            node.attrs.t = unixTimestampSeconds().toString();
        }
        
        if (type === 'sender' && isJidUser(jid)) {
            node.attrs.recipient = jid;
            node.attrs.to = participant;
        } else {
            node.attrs.to = jid;
            if (participant) {
                node.attrs.participant = participant;
            }
        }
        
        if (type) {
            node.attrs.type = isJidNewsLetter(jid) ? 'read-self' : type;
        }
        
        const remainingMessageIds = messageIds.slice(1);
        if (remainingMessageIds.length) {
            node.content = [
                {
                    tag: 'list',
                    attrs: {},
                    content: remainingMessageIds.map(id => ({
                        tag: 'item',
                        attrs: { id }
                    }))
                }
            ];
        }
        
        logger.debug({ attrs: node.attrs, messageIds }, 'sending receipt for messages');
        await sendNode(node);
    };

    const sendReceipts = async (keys, type) => {
        const recps = aggregateMessageKeysNotFromMe(keys);
        for (const { jid, participant, messageIds } of recps) {
            await sendReceipt(jid, participant, messageIds, type);
        }
    };

    const readMessages = async (keys) => {
        const privacySettings = await fetchPrivacySettings();
        const readType = privacySettings.readreceipts === 'all' ? 'read' : 'read-self';
        await sendReceipts(keys, readType);
    };

    const getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
        const deviceResults = [];
        
        if (!useCache) {
            logger.debug('not using cache for devices');
        }
        
        const toFetch = [];
        jids = Array.from(new Set(jids));
        
        for (let jid of jids) {
            const user = jidDecode(jid)?.user;
            jid = jidNormalizedUser(jid);
            
            if (useCache) {
                const devices = userDevicesCache.get(user);
                if (devices) {
                    deviceResults.push(...devices);
                    logger.trace({ user }, 'using cache for devices');
                } else {
                    toFetch.push(jid);
                }
            } else {
                toFetch.push(jid);
            }
        }
        
        if (!toFetch.length) {
            return deviceResults;
        }
        
        const query = new USyncQuery()
            .withContext('message')
            .withDeviceProtocol();
            
        for (const jid of toFetch) {
            query.withUser(new USyncUser().withId(jid));
        }
        
        const result = await executeUSyncQuery(query);
        
        if (result) {
            const extracted = extractDeviceJids(result?.list, authState.creds.me.id, ignoreZeroDevices);
            const deviceMap = {};
            
            for (const item of extracted) {
                deviceMap[item.user] = deviceMap[item.user] || [];
                deviceMap[item.user].push(item);
                deviceResults.push(item);
            }
            
            for (const key in deviceMap) {
                userDevicesCache.set(key, deviceMap[key]);
            }
        }
        
        return deviceResults;
    };

    const assertSessions = async (jids, force) => {
        let didFetchNewSession = false;
        let jidsRequiringFetch = [];
        
        if (force) {
            jidsRequiringFetch = jids;
        } else {
            const addrs = jids.map(jid => signalRepository.jidToSignalProtocolAddress(jid));
            const sessions = await authState.keys.get('session', addrs);
            
            for (const jid of jids) {
                const signalId = signalRepository.jidToSignalProtocolAddress(jid);
                if (!sessions[signalId]) {
                    jidsRequiringFetch.push(jid);
                }
            }
        }
        
        if (jidsRequiringFetch.length) {
            logger.debug({ jidsRequiringFetch }, 'fetching sessions');
            const result = await query({
                tag: 'iq',
                attrs: {
                    xmlns: 'encrypt',
                    type: 'get',
                    to: S_WHATSAPP_NET
                },
                content: [
                    {
                        tag: 'key',
                        attrs: {},
                        content: jidsRequiringFetch.map(jid => ({
                            tag: 'user',
                            attrs: { jid }
                        }))
                    }
                ]
            });
            
            await parseAndInjectE2ESessions(result, signalRepository);
            didFetchNewSession = true;
        }
        
        return didFetchNewSession;
    };

    const sendPeerDataOperationMessage = async (pdoMessage) => {
        if (!authState.creds.me?.id) {
            throw new Boom('Not authenticated');
        }
        
        const protocolMessage = {
            protocolMessage: {
                peerDataOperationRequestMessage: pdoMessage,
                type: proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
            }
        };
        
        const meJid = jidNormalizedUser(authState.creds.me.id);
        const msgId = await relayMessage(meJid, protocolMessage, {
            additionalAttributes: {
                category: 'peer',
                push_priority: 'high_force'
            }
        });
        
        return msgId;
    };

    const createParticipantNodes = async (jids, message, extraAttrs) => {
        const patched = await patchMessageBeforeSending(message, jids);
        const bytes = encodeWAMessage(patched);
        let shouldIncludeDeviceIdentity = false;
        
        const nodes = await Promise.all(jids.map(async (jid) => {
            const { type, ciphertext } = await signalRepository.encryptMessage({ jid, data: bytes });
            
            if (type === 'pkmsg') {
                shouldIncludeDeviceIdentity = true;
            }
            
            const node = {
                tag: 'to',
                attrs: { jid },
                content: [{
                    tag: 'enc',
                    attrs: {
                        v: '2',
                        type,
                        ...(extraAttrs || {})
                    },
                    content: ciphertext
                }]
            };
            
            return node;
        }));
        
        return { nodes, shouldIncludeDeviceIdentity };
    };

    // Fungsi tambahan dari kode atas
    const getTypeMessage = (msg) => {
        const message = normalizeMessageContent(msg);
        if (message.reactionMessage) {
            return 'reaction';
        } else if (getMediaType(message)) {
            return 'media';
        } else {
            return 'text';
        }
    };

    const getMediaType = (message) => {
        if (message.imageMessage) {
            return 'image';
        } else if (message.videoMessage) {
            return message.videoMessage.gifPlayback ? 'gif' : 'video';
        } else if (message.audioMessage) {
            return message.audioMessage.ptt ? 'ptt' : 'audio';
        } else if (message.contactMessage) {
            return 'vcard';
        } else if (message.documentMessage) {
            return 'document';
        } else if (message.contactsArrayMessage) {
            return 'contact_array';
        } else if (message.liveLocationMessage) {
            return 'livelocation';
        } else if (message.stickerMessage) {
            return 'sticker';
        } else if (message.listMessage) {
            return 'list';
        } else if (message.listResponseMessage) {
            return 'list_response';
        } else if (message.buttonsResponseMessage) {
            return 'buttons_response';
        } else if (message.orderMessage) {
            return 'order';
        } else if (message.productMessage) {
            return 'product';
        } else if (message.interactiveResponseMessage) {
            return 'native_flow_response';
        } else if (message.groupInviteMessage) {
            return 'url';
        } else if (/https:\/\/wa\.me\/p\/\d+\/\d+/.test(message.extendedTextMessage?.text)) {
            return 'productlink';
        }
    };

    const getButtonType = (message) => {
        if (message.listMessage) {
            return 'list';
        } else if (message.buttonsMessage) {
            return 'buttons';
        } else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'review_and_pay') {
            return 'review_and_pay';
        } else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'review_order') {
            return 'review_order';
        } else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'payment_info') {
            return 'payment_info';
        } else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'payment_status') {
            return 'payment_status';
        } else if (message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name === 'payment_method') {
            return 'payment_method';
        } else if (message.interactiveMessage && message.interactiveMessage?.nativeFlowMessage) {
            return 'interactive';
        } else if (message.interactiveMessage?.nativeFlowMessage) {
            return 'native_flow';
        }
    };

    // Helper function untuk getAdditionalNode (dibuat sederhana)
    const getAdditionalNode = (buttonType: string) => {
        // Implementasi sederhana, sesuaikan dengan kebutuhan
        return [{
            tag: 'biz',
            attrs: { type: buttonType }
        }];
    };

    const relayMessage = async (jid, message, { 
        messageId: msgId, 
        participant, 
        additionalAttributes, 
        additionalNodes, 
        useUserDevicesCache, 
        cachedGroupMetadata, 
        useCachedGroupMetadata, 
        statusJidList, 
        AI = true 
    }) => {
        const meId = authState.creds.me.id;
        let shouldIncludeDeviceIdentity = false;
        let didPushAdditional = false;
        
        const { user, server } = jidDecode(jid);
        const statusJid = 'status@broadcast';
        const isGroup = server === 'g.us';
        const isStatus = jid === statusJid;
        const isLid = server === 'lid';
        const isPrivate = server === 's.whatsapp.net';
        const isNewsletter = server === 'newsletter';
        
        msgId = msgId || generateMessageIDV2(sock.user?.id);
        useUserDevicesCache = useUserDevicesCache !== false;
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus;
        
        const participants = [];
        const destinationJid = !isStatus ? 
            jidEncode(
                user, 
                isLid ? 'lid' : isGroup ? 'g.us' : isNewsletter ? 'newsletter' : 's.whatsapp.net'
            ) : statusJid;
        
        const binaryNodeContent = [];
        const devices = [];
        const meMsg = {
            deviceSentMessage: {
                destinationJid,
                message
            }
        };
        
        const extraAttrs: Record<string, string> = {};
        const messages = normalizeMessageContent(message);
        const buttonType = getButtonType(messages);
        
        if (participant) {
            if (!isGroup && !isStatus) {
                additionalAttributes = { ...additionalAttributes, device_fanout: 'false' };
            }
            const { user, device } = jidDecode(participant.jid);
            devices.push({ user, device });
        }
        
        await authState.keys.transaction(async () => {
            const mediaType = getMediaType(messages);
            if (mediaType) {
                extraAttrs['mediatype'] = mediaType;
            }
            
            if (messages.pinInChatMessage || messages.keepInChatMessage || 
                message.reactionMessage || message.protocolMessage?.editedMessage) {
                extraAttrs['decrypt-fail'] = 'hide';
            }
            
            if (messages.interactiveResponseMessage?.nativeFlowResponseMessage) {
                extraAttrs['native_flow_name'] = messages.interactiveResponseMessage?.nativeFlowResponseMessage.name;
            }
            
            if (isNewsletter) {
                // Message edit
                if (message.protocolMessage?.editedMessage) {
                    msgId = message.protocolMessage.key?.id;
                    message = message.protocolMessage.editedMessage;
                }
                
                // Message delete
                if (message.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                    msgId = message.protocolMessage.key?.id;
                    message = {};
                }
                
                const patched = await patchMessageBeforeSending(message, []);
                const bytes = encodeNewsletterMessage(patched);
                
                binaryNodeContent.push({
                    tag: 'plaintext',
                    attrs: extraAttrs,
                    content: bytes
                });
            } 
            else if (isGroup || isStatus) {
                const [groupData, senderKeyMap] = await Promise.all([
                    (async () => {
                        let groupData = useCachedGroupMetadata && cachedGroupMetadata ? 
                            await cachedGroupMetadata(jid) : undefined;
                        if (groupData) {
                            logger.trace({ jid, participants: groupData.participants.length }, 
                                'using cached group metadata');
                        } else if (!isStatus) {
                            groupData = await groupMetadata(jid);
                        }
                        return groupData;
                    })(),
                    (async () => {
                        if (!participant && !isStatus) {
                            const result = await authState.keys.get('sender-key-memory', [jid]);
                            return result[jid] || {};
                        }
                        return {};
                    })()
                ]);
                
                if (!participant) {
                    const participantsList = (groupData && !isStatus) ? 
                        groupData.participants.map(p => p.id) : [];
                    
                    if (isStatus && statusJidList) {
                        participantsList.push(...statusJidList);
                    }
                    
                    const additionalDevices = await getUSyncDevices(
                        participantsList, 
                        !!useUserDevicesCache, 
                        false
                    );
                    devices.push(...additionalDevices);
                }
                
                const patched = await patchMessageBeforeSending(message, 
                    devices.map(d => jidEncode(d.user, isLid ? 'lid' : 's.whatsapp.net', d.device)));
                const bytes = encodeWAMessage(patched);
                
                const { ciphertext, senderKeyDistributionMessage } = 
                    await signalRepository.encryptGroupMessage({
                        group: destinationJid,
                        data: bytes,
                        meId
                    });
                
                const senderKeyJids = [];
                for (const { user, device } of devices) {
                    const jid = jidEncode(
                        user, 
                        groupData?.addressingMode === 'lid' ? 'lid' : 's.whatsapp.net', 
                        device
                    );
                    if (!senderKeyMap[jid] || !!participant) {
                        senderKeyJids.push(jid);
                        senderKeyMap[jid] = true;
                    }
                }
                
                if (senderKeyJids.length) {
                    logger.debug({ senderKeyJids }, 'sending new sender key');
                    const senderKeyMsg = {
                        senderKeyDistributionMessage: {
                            axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                            groupId: destinationJid
                        }
                    };
                    
                    await assertSessions(senderKeyJids, false);
                    const result = await createParticipantNodes(senderKeyJids, senderKeyMsg, extraAttrs);
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
                    participants.push(...result.nodes);
                }
                
                binaryNodeContent.push({
                    tag: 'enc',
                    attrs: { v: '2', type: 'skmsg', ...extraAttrs },
                    content: ciphertext
                });
                
                await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } });
            } 
            else {
                const { user: meUser } = jidDecode(meId);
                
                if (!participant) {
                    devices.push({ user });
                    if (user !== meUser) {
                        devices.push({ user: meUser });
                    }
                    
                    if (additionalAttributes?.['category'] !== 'peer') {
                        const additionalDevices = await getUSyncDevices(
                            [meId, jid], 
                            !!useUserDevicesCache, 
                            true
                        );
                        devices.push(...additionalDevices);
                    }
                }
                
                const allJids = [];
                const meJids = [];
                const otherJids = [];
                
                for (const { user, device } of devices) {
                    const isMe = user === meUser;
                    const jid = jidEncode(
                        isMe && isLid ? authState.creds?.me?.lid?.split(':')[0] || user : user,
                        isLid ? 'lid' : 's.whatsapp.net',
                        device
                    );
                    
                    if (isMe) {
                        meJids.push(jid);
                    } else {
                        otherJids.push(jid);
                    }
                    allJids.push(jid);
                }
                
                await assertSessions(allJids, false);
                
                const [{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 }, 
                      { nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }] = await Promise.all([
                    createParticipantNodes(meJids, meMsg, extraAttrs),
                    createParticipantNodes(otherJids, message, extraAttrs)
                ]);
                
                participants.push(...meNodes);
                participants.push(...otherNodes);
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2;
            }
            
            if (participants.length) {
                if (additionalAttributes?.['category'] === 'peer') {
                    const peerNode = participants[0]?.content?.[0];
                    if (peerNode) {
                        binaryNodeContent.push(peerNode);
                    }
                } else {
                    binaryNodeContent.push({
                        tag: 'participants',
                        attrs: {},
                        content: participants
                    });
                }
            }
            
            const stanza = {
                tag: 'message',
                attrs: {
                    id: msgId,
                    type: getTypeMessage(messages),
                    ...(additionalAttributes || {})
                },
                content: binaryNodeContent
            };
            
            if (participant) {
                if (isJidGroup(destinationJid)) {
                    stanza.attrs.to = destinationJid;
                    stanza.attrs.participant = participant.jid;
                } else if (areJidsSameUser(participant.jid, meId)) {
                    stanza.attrs.to = participant.jid;
                    stanza.attrs.recipient = destinationJid;
                } else {
                    stanza.attrs.to = participant.jid;
                }
            } else {
                stanza.attrs.to = destinationJid;
            }
            
            if (shouldIncludeDeviceIdentity) {
                stanza.content.push({
                    tag: 'device-identity',
                    attrs: {},
                    content: encodeSignedDeviceIdentity(authState.creds.account, true)
                });
                logger.debug({ jid }, 'adding device identity');
            }
            
            if (AI && isPrivate) {
                const botNode = {
                    tag: 'bot',
                    attrs: {
                        biz_bot: '1'
                    }
                };
                
                const filteredBizBot = getBinaryNodeFilter(additionalNodes || []);
                if (filteredBizBot) {
                    stanza.content.push(...additionalNodes);
                    didPushAdditional = true;
                } else {
                    stanza.content.push(botNode);
                }
            }
            
            if (!isNewsletter && buttonType && !isStatus) {
                const content = getAdditionalNode(buttonType);
                const filteredNode = getBinaryNodeFilter(additionalNodes || []);
                
                if (filteredNode) {
                    didPushAdditional = true;
                    stanza.content.push(...additionalNodes);
                } else {
                    stanza.content.push(...content);
                }
                logger.debug({ jid }, 'adding business node');
            }
            
            if (!didPushAdditional && additionalNodes && additionalNodes.length > 0) {
                stanza.content.push(...additionalNodes);
            }
            
            logger.debug({ msgId }, `sending message to ${participants.length} devices`);
            await sendNode(stanza);
        });
        
        return msgId;
    };

    const getPrivacyTokens = async (jids) => {
        const t = unixTimestampSeconds().toString();
        const result = await query({
            tag: 'iq',
            attrs: {
                to: S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'privacy'
            },
            content: [
                {
                    tag: 'tokens',
                    attrs: {},
                    content: jids.map(jid => ({
                        tag: 'token',
                        attrs: {
                            jid: jidNormalizedUser(jid),
                            t,
                            type: 'trusted_contact'
                        }
                    }))
                }
            ]
        });
        return result;
    };

    const waUploadToServer = getWAUploadToServer(config, refreshMediaConn);
    const zerone = new starx(waUploadToServer, relayMessage);
    const waitForMsgMediaUpdate = bindWaitForEvent(ev, 'messages.media-update');
    
    return {
        ...sock,
        getPrivacyTokens,
        assertSessions,
        relayMessage,
        sendReceipt,
        sendReceipts,
        zerone,
        readMessages,
        refreshMediaConn,
        waUploadToServer,
        fetchPrivacySettings,
        sendPeerDataOperationMessage,
        createParticipantNodes,
        getUSyncDevices,
        updateMediaMessage: async (message) => {
            const content = assertMediaContent(message.message);
            const mediaKey = content.mediaKey;
            const meId = authState.creds.me.id;
            const node = await encryptMediaRetryRequest(message.key, mediaKey, meId);
            let error = undefined;
            
            await Promise.all([
                sendNode(node),
                waitForMsgMediaUpdate(async (update) => {
                    const result = update.find(c => c.key.id === message.key.id);
                    if (result) {
                        if (result.error) {
                            error = result.error;
                        } else {
                            try {
                                const media = await decryptMediaRetryData(result.media, mediaKey, result.key.id);
                                if (media.result !== proto.MediaRetryNotification.ResultType.SUCCESS) {
                                    const resultStr = proto.MediaRetryNotification.ResultType[media.result];
                                    throw new Boom(`Media re-upload failed by device (${resultStr})`, {
                                        data: media,
                                        statusCode: getStatusCodeForMediaRetry(media.result) || 404
                                    });
                                }
                                content.directPath = media.directPath;
                                content.url = getUrlFromDirectPath(content.directPath);
                                logger.debug({ directPath: media.directPath, key: result.key }, 
                                    'media update successful');
                            } catch (err) {
                                error = err;
                            }
                        }
                        return true;
                    }
                })
            ]);
            
            if (error) {
                throw error;
            }
            
            ev.emit('messages.update', [{ 
                key: message.key, 
                update: { message: message.message } 
            }]);
            
            return message;
        },
        sendMessage: async (jid, content, options = {}) => {
            const userJid = authState.creds.me.id;
            delete options.ephemeralExpiration;
            
            const { filter = false, quoted } = options;
            const getParticipantAttr = () => filter ? { participant: { jid } } : {};
            
            const messageType = zerone.detectType ? zerone.detectType(content) : null;
            
            if (typeof content === 'object' && 
                'disappearingMessagesInChat' in content &&
                typeof content['disappearingMessagesInChat'] !== 'undefined' && 
                isJidGroup(jid)) {
                const { disappearingMessagesInChat } = content;
                const value = typeof disappearingMessagesInChat === 'boolean'
                    ? (disappearingMessagesInChat ? WA_DEFAULT_EPHEMERAL : 0)
                    : disappearingMessagesInChat;
                    
                await groupToggleEphemeral(jid, value);
            } else {
                if (messageType && zerone) {
                    switch(messageType) {
                        case 'PAYMENT':
                            if (zerone.handlePayment) {
                                const paymentContent = await zerone.handlePayment(content, quoted);
                                return await relayMessage(jid, paymentContent, {
                                    messageId: generateMessageIDV2(sock.user?.id),
                                    ...getParticipantAttr()
                                });
                            }
                            break;
                            
                        case 'PRODUCT':
                            if (zerone.handleProduct) {
                                const productContent = await zerone.handleProduct(content, jid, quoted);
                                const productMsg = await generateWAMessageFromContent(jid, productContent, { quoted });
                                return await relayMessage(jid, productMsg.message, {
                                    messageId: productMsg.key.id,
                                    ...getParticipantAttr()
                                });
                            }
                            break;
                            
                        case 'INTERACTIVE':
                            if (zerone.handleInteractive) {
                                const interactiveContent = await zerone.handleInteractive(content, jid, quoted);
                                const interactiveMsg = await generateWAMessageFromContent(jid, interactiveContent, { quoted });
                                return await relayMessage(jid, interactiveMsg.message, {
                                    messageId: interactiveMsg.key.id,
                                    ...getParticipantAttr()
                                });
                            }
                            break;
                            
                        case 'ALBUM':
                            if (zerone.handleAlbum) {
                                const albumContent = await zerone.handleAlbum(content, jid, quoted);
                                return albumContent;
                            }
                            break;
                            
                        case 'EVENT':
                            if (zerone.handleEvent) {
                                return await zerone.handleEvent(content, jid, quoted);
                            }
                            break;
                            
                        case 'POLL_RESULT':
                            if (zerone.handlePollResult) {
                                return await zerone.handlePollResult(content, jid, quoted);
                            }
                            break;
                    }
                }
                
                const fullMsg = await generateWAMessage(jid, content, {
                    logger,
                    userJid,
                    quoted,
                    getUrlInfo: text => getUrlInfo(text, {
                        thumbnailWidth: linkPreviewImageThumbnailWidth,
                        fetchOpts: {
                            timeout: 3000,
                            ...(axiosOptions || {})
                        },
                        logger,
                        uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
                    }),
                    upload: async (readStream, opts) => {
                        const up = await waUploadToServer(readStream, {
                            ...opts,
                            newsletter: isJidNewsLetter(jid)
                        });
                        return up;
                    },
                    mediaCache: config.mediaCache,
                    options: config.options,
                    ...options
                });
                
                const isDeleteMsg = 'delete' in content && !!content.delete;
                const isEditMsg = 'edit' in content && !!content.edit;
                const isAiMsg = 'ai' in content && !!content.ai;
                const isPinMsg = 'pin' in content && !!content.pin;
                const isPollMessage = 'poll' in content && !!content.poll;
                
                const additionalAttributes: Record<string, string> = {};
                const additionalNodes = [];
                
                if (isDeleteMsg) {
                    const fromMe = content.delete?.fromMe;
                    const isGroup = isJidGroup(content.delete?.remoteJid);
                    additionalAttributes.edit = (isGroup && !fromMe) || isJidNewsLetter(jid) ? '8' : '7';
                } else if (isEditMsg) {
                    additionalAttributes.edit = isJidNewsLetter(jid) ? '3' : '1';
                } else if (isAiMsg) {
                    additionalNodes.push({
                        attrs: { biz_bot: '1' },
                        tag: "bot"
                    });
                } else if (isPinMsg) {
                    additionalAttributes.edit = '2';
                } else if (isPollMessage) {
                    additionalNodes.push({
                        tag: 'meta',
                        attrs: { polltype: 'creation' }
                    });
                }
                
                await relayMessage(jid, fullMsg.message, {
                    messageId: fullMsg.key.id,
                    cachedGroupMetadata: options.cachedGroupMetadata,
                    additionalNodes: isAiMsg ? additionalNodes : options.additionalNodes,
                    additionalAttributes,
                    statusJidList: options.statusJidList
                });
                
                if (config.emitOwnEvents) {
                    process.nextTick(() => {
                        processingMutex.mutex(() => upsertMessage(fullMsg, 'append'));
                    });
                }
                
                return fullMsg;
            }
        }
    };
};