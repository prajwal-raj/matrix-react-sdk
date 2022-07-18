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

/// <reference types="cypress" />

import { PollResponseEvent } from "matrix-events-sdk";

import { SynapseInstance } from "../../plugins/synapsedocker";
import { MatrixClient } from "../../global";
import Chainable = Cypress.Chainable;

const hideTimestampCSS = ".mx_MessageTimestamp { visibility: hidden !important; }";

describe("Polls", () => {
    let synapse: SynapseInstance;

    type CreatePollOptions = {
        title: string;
        options: string[];
    };
    const createPoll = ({ title, options }: CreatePollOptions) => {
        if (options.length < 2) {
            throw new Error('Poll must have at least two options');
        }
        cy.get('.mx_PollCreateDialog').within((pollCreateDialog) => {
            cy.get('#poll-topic-input').type(title);

            options.forEach((option, index) => {
                const optionId = `#pollcreate_option_${index}`;

                // click 'add option' button if needed
                if (pollCreateDialog.find(optionId).length === 0) {
                    cy.get('.mx_PollCreateDialog_addOption').scrollIntoView().click();
                }
                cy.get(optionId).scrollIntoView().type(option);
            });
        });
        cy.get('.mx_Dialog button[type="submit"]').click();
    };

    const getPollTile = (pollId: string): Chainable<JQuery> => {
        return cy.get(`.mx_RoomView_body .mx_EventTile[data-scroll-tokens="${pollId}"`);
    };

    const getPollOption = (pollId: string, optionText: string): Chainable<JQuery> => {
        return getPollTile(pollId).contains('.mx_MPollBody_option .mx_StyledRadioButton', optionText);
    };

    const expectPollOptionVoteCount = (pollId: string, optionText: string, votes: number): void => {
        getPollOption(pollId, optionText).within(() => {
            cy.get('.mx_MPollBody_optionVoteCount').should('contain', `${votes} vote`);
        });
    };

    const botVoteForOption = (bot: MatrixClient, roomId: string, pollId: string, optionText: string): void => {
        getPollOption(pollId, optionText).within(ref => {
            cy.get('input[type="radio"]').invoke('attr', 'value').then(optionId => {
                const pollVote = PollResponseEvent.from([optionId], pollId).serialize();
                bot.sendEvent(
                    roomId,
                    pollVote.type,
                    pollVote.content,
                );
            });
        });
    };

    beforeEach(() => {
        // Default threads to ON for this spec
        cy.window().then(win => {
            win.localStorage.setItem("mx_lhs_size", "0"); // Collapse left panel for these tests
        });
        cy.startSynapse("default").then(data => {
            synapse = data;

            cy.initTestUser(synapse, "Tom");
        });
    });

    afterEach(() => {
        cy.stopSynapse(synapse);
    });

    it("Open polls work as expected", () => {
        let bot: MatrixClient;
        cy.getBot(synapse, { displayName: "BotBob" }).then(_bot => {
            bot = _bot;
        });

        let roomId: string;
        cy.createRoom({}).then(_roomId => {
            roomId = _roomId;
            cy.inviteUser(roomId, bot.getUserId());
            cy.visit('/#/room/' + roomId);
        });

        cy.openMessageComposerOptions().within(() => {
            cy.get('[aria-label="Poll"]').click();
        });

        cy.get('.mx_CompoundDialog').percySnapshotElement('Polls Composer');

        const pollParams = {
            title: 'Does the polls feature work?',
            options: ['Yes', 'No', 'Maybe'],
        };
        createPoll(pollParams);

        // Wait for message to send, get its ID and save as @pollId
        cy.get(".mx_RoomView_body .mx_EventTile").contains(".mx_EventTile[data-scroll-tokens]", pollParams.title)
            .invoke("attr", "data-scroll-tokens").as("pollId");

        cy.get<string>("@pollId").then(pollId => {
            getPollTile(pollId).percySnapshotElement('Polls Timeline tile - no votes', { percyCSS: hideTimestampCSS });

            // Bot votes 'Maybe' in the poll
            botVoteForOption(bot, roomId, pollId, pollParams.options[2]);

            // no votes shown until I vote, check bots vote has arrived
            cy.get('.mx_MPollBody_totalVotes').should('contain', '1 vote cast');

            // vote 'Maybe'
            getPollOption(pollId, pollParams.options[2]).click('topLeft');
            // both me and bot have voted Maybe
            expectPollOptionVoteCount(pollId, pollParams.options[2], 2);

            // change my vote to 'Yes'
            getPollOption(pollId, pollParams.options[0]).click('topLeft');

            // 1 vote for yes
            expectPollOptionVoteCount(pollId, pollParams.options[0], 1);
            // and one for maybe
            expectPollOptionVoteCount(pollId, pollParams.options[2], 1);

            // Bot updates vote to 'No'
            botVoteForOption(bot, roomId, pollId, pollParams.options[1]);

            // 1 vote for yes
            expectPollOptionVoteCount(pollId, pollParams.options[0], 1);
            // 1 vote for no
            expectPollOptionVoteCount(pollId, pollParams.options[0], 1);
            // 1 for maybe
            expectPollOptionVoteCount(pollId, pollParams.options[2], 0);
        });
    });
});
