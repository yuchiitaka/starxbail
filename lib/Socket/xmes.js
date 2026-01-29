import { proto } from '../../WAProto';
import crypto from 'crypto';
import type { WASocket } from '../Types';
import { 
    generateWAMessage, 
    generateWAMessageFromContent, 
    prepareWAMessageMedia,
    generateWAMessageContent 
} from '../Utils';

type ContentType = {
    requestPaymentMessage?: any;
    productMessage?: any;
    interactiveMessage?: any;
    albumMessage?: any;
    eventMessage?: any;
    pollResultMessage?: any;
    locationMessage?: any;
    paymentListMessage?: any;
};

type QuotedType = {
    key?: {
        id?: string;
        participant?: string;
        remoteJid?: string;
        fromMe?: boolean;
    };
    message?: any;
};

type ButtonType = {
    type: 'cta_reply' | 'cta_url' | 'cta_copy' | 'cta_call' | 'single_select';
    title: string;
    id?: string;
    url?: string;
    phoneNumber?: string;
    copyText?: string;
    sections?: Array<{
        title: string;
        rows: Array<{
            id: string;
            title: string;
            description?: string;
        }>;
    }>;
    buttonParamsJson?: string;
};

export class starx {
    private utils: any;
    private relayMessageFn: any;
    private waUploadToServer: any;

    constructor(utils: any, waUploadToServer: any, relayMessageFn: any) {
        this.utils = utils;
        this.waUploadToServer = waUploadToServer;
        this.relayMessageFn = relayMessageFn;
    }

    detectType(content: ContentType): string | null {
        if (content.requestPaymentMessage) return 'PAYMENT';
        if (content.productMessage) return 'PRODUCT';
        if (content.interactiveMessage) return 'INTERACTIVE';
        if (content.albumMessage) return 'ALBUM';
        if (content.eventMessage) return 'EVENT';
        if (content.pollResultMessage) return 'POLL_RESULT';
        if (content.locationMessage) return 'LOCATION';
        if (content.paymentListMessage) return 'PAYMENT_LIST';
        return null;
    }

    // Helper function to process buttons for all message types
    private processButtons(buttons: ButtonType[] = []): any {
        const nativeFlowButtons: any[] = [];
        const interactiveButtons: any[] = [];

        for (const button of buttons) {
            let buttonParams: any = {};

            // Parse buttonParamsJson if provided
            if (button.buttonParamsJson) {
                try {
                    buttonParams = JSON.parse(button.buttonParamsJson);
                } catch (e) {
                    buttonParams = {};
                }
            }

            switch (button.type) {
                case 'cta_reply':
                    nativeFlowButtons.push({
                        name: "cta_reply",
                        buttonParamsJson: JSON.stringify({
                            display_text: button.title,
                            id: button.id || button.title.toLowerCase().replace(/\s+/g, '_'),
                            ...buttonParams
                        })
                    });
                    interactiveButtons.push({
                        buttonId: button.id || button.title.toLowerCase().replace(/\s+/g, '_'),
                        buttonText: { displayText: button.title },
                        type: 1
                    });
                    break;

                case 'cta_url':
                    nativeFlowButtons.push({
                        name: "cta_url",
                        buttonParamsJson: JSON.stringify({
                            display_text: button.title,
                            url: button.url,
                            ...buttonParams
                        })
                    });
                    interactiveButtons.push({
                        buttonId: button.id || button.title.toLowerCase().replace(/\s+/g, '_'),
                        buttonText: { displayText: button.title },
                        type: 5,
                        nativeFlowInfo: {
                            name: "cta_url",
                            paramsJson: JSON.stringify({
                                link_url: button.url
                            })
                        }
                    });
                    break;

                case 'cta_copy':
                    nativeFlowButtons.push({
                        name: "cta_copy",
                        buttonParamsJson: JSON.stringify({
                            display_text: button.title,
                            copy_text: button.copyText || button.title,
                            ...buttonParams
                        })
                    });
                    interactiveButtons.push({
                        buttonId: button.id || button.title.toLowerCase().replace(/\s+/g, '_'),
                        buttonText: { displayText: button.title },
                        type: 6,
                        nativeFlowInfo: {
                            name: "cta_copy",
                            paramsJson: JSON.stringify({
                                copy_text: button.copyText || button.title
                            })
                        }
                    });
                    break;

                case 'cta_call':
                    nativeFlowButtons.push({
                        name: "cta_call",
                        buttonParamsJson: JSON.stringify({
                            display_text: button.title,
                            phone_number: button.phoneNumber,
                            ...buttonParams
                        })
                    });
                    interactiveButtons.push({
                        buttonId: button.id || button.title.toLowerCase().replace(/\s+/g, '_'),
                        buttonText: { displayText: button.title },
                        type: 7,
                        nativeFlowInfo: {
                            name: "cta_call",
                            paramsJson: JSON.stringify({
                                phone_number: button.phoneNumber
                            })
                        }
                    });
                    break;

                case 'single_select':
                    if (button.sections && button.sections.length > 0) {
                        const sections = button.sections.map(section => ({
                            title: section.title,
                            rows: section.rows.map(row => ({
                                rowId: row.id,
                                title: row.title,
                                description: row.description || ""
                            }))
                        }));

                        nativeFlowButtons.push({
                            name: "single_select",
                            buttonParamsJson: JSON.stringify({
                                sections,
                                ...buttonParams
                            })
                        });

                        // Untuk WhatsApp Messenger (tanpa native flow)
                        interactiveButtons.push({
                            buttonId: button.id || 'single_select',
                            buttonText: { displayText: button.title },
                            type: 2
                        });
                    }
                    break;
            }
        }

        return { nativeFlowButtons, interactiveButtons };
    }

    async handlePayment(content: any, quoted?: QuotedType): Promise<any> {
        const data = content.requestPaymentMessage;
        let notes: any = {};

        if (data.sticker?.stickerMessage) {
            notes = {
                stickerMessage: {
                    ...data.sticker.stickerMessage,
                    contextInfo: {
                        stanzaId: quoted?.key?.id,
                        participant: quoted?.key?.participant || content.sender,
                        quotedMessage: quoted?.message
                    }
                }
            };
        } else if (data.note) {
            notes = {
                extendedTextMessage: {
                    text: data.note,
                    contextInfo: {
                        stanzaId: quoted?.key?.id,
                        participant: quoted?.key?.participant || content.sender,
                        quotedMessage: quoted?.message
                    }
                }
            };
        }

        return {
            requestPaymentMessage: proto.Message.RequestPaymentMessage.fromObject({
                expiryTimestamp: data.expiry || 0,
                amount1000: data.amount || 0,
                currencyCodeIso4217: data.currency || "IDR",
                requestFrom: data.from || "0@s.whatsapp.net",
                noteMessage: notes,
                background: data.background ?? {
                    id: "DEFAULT",
                    placeholderArgb: 0xFFF0F0F0
                }
            })
        };
    }

    async handleProduct(content: any, jid: string, quoted?: QuotedType): Promise<any> {
        const {
            title,
            description,
            thumbnail,
            productId,
            retailerId,
            url,
            body = "",
            footer = "",
            buttons = [],
            priceAmount1000 = null,
            currencyCode = "IDR"
        } = content.productMessage;

        let productImage: any;

        if (Buffer.isBuffer(thumbnail)) {
            const { imageMessage } = await generateWAMessageContent(
                { image: thumbnail },
                { upload: this.waUploadToServer }
            );
            productImage = imageMessage;
        } else if (typeof thumbnail === 'object' && thumbnail.url) {
            const { imageMessage } = await generateWAMessageContent(
                { image: { url: thumbnail.url } },
                { upload: this.waUploadToServer }
            );
            productImage = imageMessage;
        } else if (thumbnail) {
            const { imageMessage } = await generateWAMessageContent(
                { image: thumbnail },
                { upload: this.waUploadToServer }
            );
            productImage = imageMessage;
        }

        // Process buttons
        const { nativeFlowButtons, interactiveButtons } = this.processButtons(buttons);

        return {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        body: { text: body },
                        footer: { text: footer },
                        header: {
                            title,
                            hasMediaAttachment: !!productImage,
                            productMessage: {
                                product: {
                                    productImage,
                                    productId,
                                    title,
                                    description,
                                    currencyCode,
                                    priceAmount1000: priceAmount1000 || 0,
                                    retailerId,
                                    url,
                                    productImageCount: productImage ? 1 : 0
                                },
                                businessOwnerJid: "0@s.whatsapp.net"
                            }
                        },
                        nativeFlowMessage: { buttons: nativeFlowButtons }
                    }
                }
            }
        };
    }

    async handleInteractive(content: any, jid: string, quoted?: QuotedType): Promise<any> {
        const {
            title,
            footer,
            thumbnail,
            image,
            video,
            document,
            mimetype,
            fileName,
            jpegThumbnail,
            contextInfo,
            externalAdReply,
            buttons = [],
            nativeFlowMessage
        } = content.interactiveMessage;

        let media: any = null;
        let mediaType: string | null = null;

        if (thumbnail) {
            media = await prepareWAMessageMedia(
                { image: { url: thumbnail } },
                { upload: this.waUploadToServer }
            );
            mediaType = 'image';
        } else if (image) {
            if (typeof image === 'object' && image.url) {
                media = await prepareWAMessageMedia(
                    { image: { url: image.url } },
                    { upload: this.waUploadToServer }
                );
            } else {
                media = await prepareWAMessageMedia(
                    { image: image },
                    { upload: this.waUploadToServer }
                );
            }
            mediaType = 'image';
        } else if (video) {
            if (typeof video === 'object' && video.url) {
                media = await prepareWAMessageMedia(
                    { video: { url: video.url } },
                    { upload: this.waUploadToServer }
                );
            } else {
                media = await prepareWAMessageMedia(
                    { video: video },
                    { upload: this.waUploadToServer }
                );
            }
            mediaType = 'video';
        } else if (document) {
            let documentPayload: any = { document: document };

            if (jpegThumbnail) {
                if (typeof jpegThumbnail === 'object' && jpegThumbnail.url) {
                    documentPayload.jpegThumbnail = { url: jpegThumbnail.url };
                } else {
                    documentPayload.jpegThumbnail = jpegThumbnail;
                }
            }

            media = await prepareWAMessageMedia(
                documentPayload,
                { upload: this.waUploadToServer }
            );

            if (fileName) {
                media.documentMessage.fileName = fileName;
            }
            if (mimetype) {
                media.documentMessage.mimetype = mimetype;
            }
            mediaType = 'document';
        }

        // Process buttons
        const { nativeFlowButtons, interactiveButtons } = this.processButtons(buttons);

        let interactiveMessage: any = {
            body: { text: title || "" },
            footer: { text: footer || "" }
        };

        // For WhatsApp Business/iOS (native flow)
        if (nativeFlowButtons.length > 0) {
            interactiveMessage.nativeFlowMessage = {
                buttons: nativeFlowButtons
            };
        }

        // For WhatsApp Messenger (interactive buttons)
        if (interactiveButtons.length > 0) {
            interactiveMessage.buttons = interactiveButtons;
        }

        if (media) {
            interactiveMessage.header = {
                title: "",
                hasMediaAttachment: true,
                ...media
            };
        } else {
            interactiveMessage.header = {
                title: "",
                hasMediaAttachment: false
            };
        }

        let finalContextInfo: any = {};

        if (contextInfo) {
            finalContextInfo = {
                mentionedJid: contextInfo.mentionedJid || [],
                forwardingScore: contextInfo.forwardingScore || 0,
                isForwarded: contextInfo.isForwarded || false,
                ...contextInfo
            };
        }

        if (externalAdReply) {
            finalContextInfo.externalAdReply = {
                title: externalAdReply.title || "",
                body: externalAdReply.body || "",
                mediaType: externalAdReply.mediaType || 1,
                thumbnailUrl: externalAdReply.thumbnailUrl || "",
                mediaUrl: externalAdReply.mediaUrl || "",
                sourceUrl: externalAdReply.sourceUrl || "",
                showAdAttribution: externalAdReply.showAdAttribution || false,
                renderLargerThumbnail: externalAdReply.renderLargerThumbnail || false,
                ...externalAdReply
            };
        }

        if (Object.keys(finalContextInfo).length > 0) {
            interactiveMessage.contextInfo = finalContextInfo;
        }

        return {
            interactiveMessage: interactiveMessage
        };
    }

    async handleAlbum(content: any, jid: string, quoted?: QuotedType): Promise<any> {
        const array = content.albumMessage;
        
        const album = await generateWAMessageFromContent(jid, {
            messageContextInfo: {
                messageSecret: crypto.randomBytes(32),
            },
            albumMessage: {
                expectedImageCount: array.filter((a: any) => a.hasOwnProperty("image")).length,
                expectedVideoCount: array.filter((a: any) => a.hasOwnProperty("video")).length,
            },
        }, {
            userJid: `${this.utils.generateMessageID().split('@')[0]}@s.whatsapp.net`,
            quoted,
            upload: this.waUploadToServer
        });

        await this.relayMessageFn(jid, album.message, {
            messageId: album.key.id,
        });

        for (let item of array) {
            const img = await generateWAMessage(jid, item, {
                upload: this.waUploadToServer,
            });

            img.message.messageContextInfo = {
                messageSecret: crypto.randomBytes(32),
                messageAssociation: {
                    associationType: 1,
                    parentMessageKey: album.key,
                },
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast",
                forwardingScore: 99999,
                isForwarded: true,
                mentionedJid: [jid],
                starred: true,
                labels: ["Y", "Important"],
                isHighlighted: true,
                businessMessageForwardInfo: {
                    businessOwnerJid: jid,
                },
                dataSharingContext: {
                    showMmDisclosure: true,
                },
            };

            img.message.forwardedNewsletterMessageInfo = {
                newsletterJid: "0@newsletter",
                serverMessageId: 1,
                newsletterName: `WhatsApp`,
                contentType: 1,
                timestamp: new Date().toISOString(),
                senderName: "Yuchii-Oz",
                content: "Text Message",
                priority: "high",
                status: "sent",
            };

            img.message.disappearingMode = {
                initiator: 3,
                trigger: 4,
                initiatorDeviceJid: jid,
                initiatedByExternalService: true,
                initiatedByUserDevice: true,
                initiatedBySystem: true,
                initiatedByServer: true,
                initiatedByAdmin: true,
                initiatedByUser: true,
                initiatedByApp: true,
                initiatedByBot: true,
                initiatedByMe: true,
            };

            await this.relayMessageFn(jid, img.message, {
                messageId: img.key.id,
                quoted: {
                    key: {
                        remoteJid: album.key.remoteJid,
                        id: album.key.id,
                        fromMe: true,
                        participant: `${this.utils.generateMessageID().split('@')[0]}@s.whatsapp.net`,
                    },
                    message: album.message,
                },
            });
        }

        return album;
    }

    async handleEvent(content: any, jid: string, quoted?: QuotedType): Promise<any> {
        const eventData = content.eventMessage;

        const msg = await generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2,
                        messageSecret: crypto.randomBytes(32),
                        supportPayload: JSON.stringify({
                            version: 2,
                            is_ai_message: true,
                            should_show_system_message: true,
                            ticket_id: crypto.randomBytes(16).toString('hex')
                        })
                    },
                    eventMessage: {
                        contextInfo: {
                            mentionedJid: [jid],
                            participant: jid,
                            remoteJid: "status@broadcast",
                            forwardedNewsletterMessageInfo: {
                                newsletterName: "System Event",
                                newsletterJid: "120363297591152843@newsletter",
                                serverMessageId: 1
                            }
                        },
                        isCanceled: eventData.isCanceled || false,
                        name: eventData.name,
                        description: eventData.description,
                        location: eventData.location || {
                            degreesLatitude: 0,
                            degreesLongitude: 0,
                            name: "Location"
                        },
                        joinLink: eventData.joinLink || '',
                        startTime: typeof eventData.startTime === 'string' ? 
                            parseInt(eventData.startTime) : eventData.startTime || Date.now(),
                        endTime: typeof eventData.endTime === 'string' ? 
                            parseInt(eventData.endTime) : eventData.endTime || Date.now() + 3600000,
                        extraGuestsAllowed: eventData.extraGuestsAllowed !== false
                    }
                }
            }
        }, { quoted });

        await this.relayMessageFn(jid, msg.message, {
            messageId: msg.key.id
        });

        return msg;
    }

    async handlePollResult(content: any, jid: string, quoted?: QuotedType): Promise<any> {
        const pollData = content.pollResultMessage;

        const msg = await generateWAMessageFromContent(jid, {
            pollResultSnapshotMessage: {
                name: pollData.name,
                pollVotes: pollData.pollVotes.map((vote: any) => ({
                    optionName: vote.optionName,
                    optionVoteCount: typeof vote.optionVoteCount === 'number' 
                        ? vote.optionVoteCount.toString() 
                        : vote.optionVoteCount
                }))
            }
        }, {
            userJid: `${this.utils.generateMessageID().split('@')[0]}@s.whatsapp.net`,
            quoted
        });

        await this.relayMessageFn(jid, msg.message, {
            messageId: msg.key.id
        });

        return msg;
    }

    // NEW: Handle Location Message
    async handleLocation(content: any, jid: string, quoted?: QuotedType): Promise<any> {
        const {
            latitude,
            longitude,
            name = "Location",
            address = "",
            caption = "",
            buttons = []
        } = content.locationMessage;

        // Process buttons
        const { nativeFlowButtons, interactiveButtons } = this.processButtons(buttons);

        // Create location message
        const locationMessage = {
            locationMessage: {
                degreesLatitude: latitude,
                degreesLongitude: longitude,
                name: name,
                address: address,
                jpegThumbnail: null,
                contextInfo: {
                    quotedMessage: quoted?.message,
                    stanzaId: quoted?.key?.id,
                    participant: quoted?.key?.participant,
                    ...(caption && {
                        caption: caption
                    }),
                    // Add buttons for WhatsApp Business/iOS
                    ...(nativeFlowButtons.length > 0 && {
                        nativeFlowMessage: {
                            buttons: nativeFlowButtons
                        }
                    }),
                    // Add buttons for WhatsApp Messenger
                    ...(interactiveButtons.length > 0 && {
                        buttons: interactiveButtons
                    })
                }
            }
        };

        // Generate message using the existing utility
        const msg = await generateWAMessage(jid, locationMessage, {
            upload: this.waUploadToServer,
            quoted
        });

        await this.relayMessageFn(jid, msg.message, {
            messageId: msg.key.id
        });

        return msg;
    }

    // NEW: Handle Payment List Message
    async handlePayList(content: any, jid: string, quoted?: QuotedType): Promise<any> {
        const {
            title,
            description,
            currency = "IDR",
            payments = [],
            buttons = []
        } = content.paymentListMessage;

        // Process buttons (only cta_url and single_select allowed for payment list)
        const filteredButtons = buttons.filter((btn: ButtonType) => 
            btn.type === 'cta_url' || btn.type === 'single_select'
        );
        const { nativeFlowButtons, interactiveButtons } = this.processButtons(filteredButtons);

        // Create payment list message
        const paymentListMessage = {
            interactiveMessage: {
                header: {
                    title: title,
                    hasMediaAttachment: false
                },
                body: {
                    text: description || "Pilih metode pembayaran:"
                },
                footer: {
                    text: "Powered by WhatsApp Business"
                },
                nativeFlowMessage: {
                    buttons: nativeFlowButtons
                },
                buttons: interactiveButtons,
                contextInfo: {
                    paymentList: {
                        title: title,
                        description: description,
                        currencyCode: currency,
                        paymentMethods: payments.map((payment: any, index: number) => ({
                            id: payment.id || `payment_${index + 1}`,
                            name: payment.name,
                            description: payment.description || "",
                            amount: payment.amount || 0,
                            currency: payment.currency || currency,
                            logo: payment.logo || null,
                            isRecommended: payment.isRecommended || false
                        }))
                    },
                    quotedMessage: quoted?.message,
                    stanzaId: quoted?.key?.id,
                    participant: quoted?.key?.participant
                }
            }
        };

        // Generate message
        const msg = await generateWAMessage(jid, paymentListMessage, {
            upload: this.waUploadToServer,
            quoted
        });

        await this.relayMessageFn(jid, msg.message, {
            messageId: msg.key.id
        });

        return msg;
    }
}

export default starx;