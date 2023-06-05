import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType, 
    ComponentType, 
    EmbedBuilder, 
} from "discord.js";
import { DefaultCommand } from "../../../utils/types";
import config from "../../../../config";
import { userData } from "../../../db";
import { setTimeout as wait } from 'node:timers/promises';
import { catchHandler } from "../../../utils/console";
import validatorCheck from "../../../utils/validatorCheck";
import collectorHandler, { toCollectParam } from "../../../utils/collectorHandler";
import validator from "validator";
import mailer from "../../../mailer";

export default <DefaultCommand> {
    name: "new",
    description: "Create an account on ArtiomsHosting",
    run: async (client, interaction) => {

        let validation1 = await validatorCheck([
            {
                callback: async () => !!await userData.get(interaction.user.id),
                interaction: {
                    embeds: [
                        new EmbedBuilder()
                        .setTitle(":x: | You already have an account")
                        .setColor("Red")
                    ]
                }
            },
            {
                callback: () => client.channels.cache.get(config.categories.createAccount)?.type !== ChannelType.GuildCategory,
                interaction: {
                    embeds: [
                        new EmbedBuilder()
                        .setTitle(":x: | Category not found")
                        .setColor("Red")
                        .setDescription("The category for creating a private channel to complete the account registration was not found in the cache. The reasons for this might be because the cache was loaded wrongly or the channel id set in the config is not available/valid. Please contact an admin!")
                    ]
                }
            }
        ])

        if(validation1) return interaction.reply(validation1)

        let channel = await interaction.guild?.channels.create({
            name: interaction.user.id,
            parent: config.categories.createAccount,
            permissionOverwrites: [{
                id: interaction.user.id,
                allow: ["ViewChannel", "ReadMessageHistory"],
            }, {
                id: interaction.guild.id,
                deny: ["ViewChannel", "SendMessages"]
            }]
        }).catch((e) => {
            catchHandler("Bot")(e)
            console.log(e)
        })

        if(!channel) return interaction.reply({
            embeds: [
                new EmbedBuilder()
                .setTitle(":x: | Channel creation error")
                .setColor("Red")
                .setDescription("An error occurred and the private channel wasnt created. There could be many reasons for this happening, some of them beeing: interaction.guild is undefined or there has been an API request error. Check console for more info!")
            ]
        })

        await interaction.reply(`Please check ${channel} to create your account!`)

        let msg = await channel.send({
            content: `${interaction.user}`,
            embeds: [
                new EmbedBuilder()
                .setTitle(`Welcome to ArtiomsHosting`)
                .setColor(`Blue`)
                .setDescription(``
                + `Hello **${interaction.user.username}**,\n`
                + `\n`                
                + `Before creating your account, you will need to agree to our terms of service and privacy policy. These policies outline the rules and regulations that govern your use of our services and the ways in which we collect, use, and protect your personal information.\n`
                + `\n`
                + `By agreeing to our terms of service and privacy policy, you are acknowledging that you understand and accept the terms outlined in these documents. If you do not agree to these terms, unfortunately, you will not be able to create an account with us.\n`
                + `\n`
                + `**So, do you accept our privacy policy and terms of service?**`
                )
                .setFooter({text: "This Interaction collector will expire in 5 minutes"})
            ],
            components: [
                new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId("acceptLegal")
                        .setLabel("Accept")
                        .setStyle(ButtonStyle.Success)
                )
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId("rejectLegal")
                        .setLabel("Reject")
                        .setStyle(ButtonStyle.Danger)
                )
            ]
        })

        const legalCollector = await msg.awaitMessageComponent({ 
            filter: (i) => {
                i.deferUpdate();
                return i.user.id === interaction.user.id
            }, 
            componentType: ComponentType.Button,
            time: 300_000 
        }).catch(catchHandler("Bot"));

        if(!legalCollector || legalCollector.customId !== "acceptLegal") {
            await msg.edit({
                content: `${interaction.user}`,
                embeds: [
                    new EmbedBuilder()
                    .setTitle(`Oh, we are sorry :(`)
                    .setColor(`Red`)
                    .setDescription(``
                    + `Bt rejecting our terms of service and privacy policy, we regret to inform you that you will not be able to create an account with us.\n`
                    + `\n`
                    + `We understand that you may have concerns or questions about our policies, and we encourage you to review them thoroughly before making a decision. If you have any questions or feedback about our terms of service or privacy policy, please do not hesitate to reach out to us.\n`
                    + `\n`
                    + `Please note that by creating an account with us, you agree to abide by our policies and regulations. We take the protection of your personal information seriously and are committed to providing you with a secure and positive user experience.\n`
                    + `\n`
                    + `**Thank you for considering our policies and for your interest in our services.**`
                    )
                    .setFooter({text: `This channel will be deleted in 30 seconds`})
                ],
                components: []
            })
            await wait(30_000);
            channel.delete().catch(() => msg.edit({
                content: null, 
                embeds: [
                    new EmbedBuilder()
                    .setTitle(":x: | Could not delete channel")
                    .setColor("Red")
                    .setDescription("This channel couldnt be deleted. Please ask an admin to delete this channel.")
                ], 
                components: []
            })).catch(catchHandler("Bot"));
            return
        }

        await channel.permissionOverwrites.edit(interaction.user, {
            SendMessages: true
        }).catch((e) => {
            catchHandler("Bot")(e);
            msg.edit(e).catch(catchHandler("Bot"))
        })

        const toCollect: toCollectParam[] = [
            {
                id: "username",
                ask: "What should be your username?",
                validation: async (message) => {
                    if(/^[A-Za-z0-9]*$/.test(message.content)) return { error: false, message: message.content.toLowerCase().trim() }
                    return {error: true, message: "The username must not have special characters. A-Za-z0-9"}
                }
            }, {
                id: "email",
                ask: "What is your email?",
                validation: async (message) => {
                    if(validator.isEmail(message.content)) return { error: false, message: message.content.toLowerCase().trim() }
                    return {error: true, message: "The email address must be valid"}
                }
            }
        ]

        if(config.mail.enabled && config.settings.verifyEmail) {
            const pin6 = Math.floor(100000 + Math.random() * 900000)
            toCollect.push({
                id: "pin6",
                ask: "What is the 6 pin code sent on your email?",
                tries: 5,
                validation: async (message) => {
                    if(message.content === pin6.toString()) return { error: false, message: message.content }
                    return { error: true, message: "The pin code is incorrect." }
                },
                run: async (collectedData) => {
                    let info = await mailer.sendMail({
                        from: config.mail.auth.user, 
                        to: collectedData.find(x => x.id === "email")?.data, 
                        subject: `${pin6} - Here is your 6pin code`, 
                        text: `Thank you for regestiring at ArtiomsHosting. Your 6pin verification code is: ${pin6}\n\nThanks and have a nice day!\nArtiomsHosting`, 
                    }).catch((err) => {
                        catchHandler("Bot")(err)
                        console.log(err)
                        channel?.send({embeds: [
                            new EmbedBuilder()
                            .setTitle("Error Sending the email")
                            .setColor("Red")
                        ]})
                    });
                }
            })
        }

        const collected = await collectorHandler({
            filter: (message) => message.author.id === interaction.user.id,
            message: msg,
            toCollect: toCollect
        })

        if(!Array.isArray(collected)) {
            channel.send({embeds: [
                new EmbedBuilder()
                .setTitle(collected.message)
                .setColor("Red")
                .setFooter({text: "This channel will be deleted in 10 seconds"})
            ]}).catch(catchHandler("Bot"))
            await wait(10_000)
            channel.delete().catch(catchHandler("Bot"))
            return
        }
        
        console.log(collected)
    }
}