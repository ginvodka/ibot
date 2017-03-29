'use strict';

const apiai = require('apiai');
const config = require('./config');
const neo4j = require("neo4j");
const gdb = new neo4j.GraphDatabase(config.NEO4J_URL);

const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const uuid = require('uuid');
const pg = require('pg'); // db connection pg

const userData = require('./user'); // module connection db

pg.defaults.ssl = true;  // db connection pg

// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
	throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
	throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
	throw new Error('missing API_AI_CLIENT_ACCESS_TOKEN');
}
if (!config.FB_APP_SECRET) {
	throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
	throw new Error('missing SERVER_URL');
}
// email configuration
/*
if (!config.SENGRID_API_KEY) { //sending email
	throw new Error('missing SENGRID_API_KEY');
}
if (!config.EMAIL_FROM) { //sending email
	throw new Error('missing EMAIL_FROM');
}
if (!config.EMAIL_TO) { //sending email
	throw new Error('missing EMAIL_TO');
}

*/
// weather like example
if (!config.WEATHER_API_KEY) { //weather api key
	throw new Error('missing WEATHER_API_KEY');
}


app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
	verify: verifyRequestSignature
}));

//serve static files in the public directory, index html at the root
app.use(express.static('public'));




// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
	extended: false
}))

// Process application/json
app.use(bodyParser.json())




const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
	language: "en",
	requestSource: "fb"
});

const sessionIds = new Map();
const userMap = new Map();

// Index route
/*
app.get('/', function (req, res) {
	res.send('Hello world, I am Integreat chat bot to help refugees');
})
*/


// test html
app.get('/home/', function (request, response) {
    response.sendFile(__dirname + '/public/index.html');
})

app.get('/blocks', function(request, response) {
    var blocks = ['Fixed', 'Movable', 'Rotating'];
    response.json(blocks);
});

var Node = module.exports = function Node(_node) {
    this._node = _node;
}

app.get('/n', function(request, response) {
	// testing neo4j
    var neo4jb = [ '1', '2'];
    //response.json(neo4jb);


    var query = [
        'MATCH (n:Attività)',
        'RETURN n',
    ].join('\n');



    gdb.cypher({
        //query: 'CREATE (n:Person {name: {personName}}) RETURN n',
        query: query,
        // params: {
        //     personName: 'Francesco'
        // }


    }, function(err, results){
        var result = results[0];
        if (err) {
            console.error('Error search into database:', err);
        } else {

          //  console.log('Node saved to database with id:', result['n']['_id']);
            console.log( result);
            var nodes = results.map(function (result) {
                return new Node(result['n']);
            });
            console.log( results);
            response.send(nodes);
        }
    });

});






// for Facebook verification
app.get('/webhook/', function (req, res) {
	console.log("request");
	if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Failed validation. Make sure the validation tokens match.");
		res.sendStatus(403);
	}
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
	var data = req.body;
	console.log(JSON.stringify(data));


	// Make sure this is a page subscription
	if (data.object == 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function (pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function (messagingEvent) {
				if (messagingEvent.optin) {
					receivedAuthentication(messagingEvent);
				} else if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				} else if (messagingEvent.delivery) {
					receivedDeliveryConfirmation(messagingEvent);
				} else if (messagingEvent.postback) {
					receivedPostback(messagingEvent);
				} else if (messagingEvent.read) {
					receivedMessageRead(messagingEvent);
				} else if (messagingEvent.account_linking) {
					receivedAccountLink(messagingEvent);
				} else {
					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
				}
			});
		});

		// Assume all went well.
		// You must send back a 200, within 20 seconds
		res.sendStatus(200);
	}
});


function setSessionAndUser(senderID){
    if (!sessionIds.has(senderID)) {
        sessionIds.set(senderID, uuid.v1());
    }

    if (!userMap.has(senderID)) {
    	    userData(function (user) {
    		    userMap.set(senderID,user);
        }, senderID);
	}




}


function receivedMessage(event) {

	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;



    setSessionAndUser(senderID);

	// console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	// console.log(JSON.stringify(message));

	var isEcho = message.is_echo;
	var messageId = message.mid;
	var appId = message.app_id;
	var metadata = message.metadata;

	// You may get a text or attachment but not both
	var messageText = message.text;
	var messageAttachments = message.attachments;
	var quickReply = message.quick_reply;

	if (isEcho) {
		handleEcho(messageId, appId, metadata);
		return;
	} else if (quickReply) {
		handleQuickReply(senderID, quickReply, messageId);
		return;
	}


	if (messageText) {
		//send message to api.ai
		sendToApiAi(senderID, messageText);
	} else if (messageAttachments) {
		handleMessageAttachments(messageAttachments, senderID);
	}
}


function handleMessageAttachments(messageAttachments, senderID){
	//for now just reply
	sendTextMessage(senderID, "Attachment received. Thank you.");	
}

function handleQuickReply(senderID, quickReply, messageId) {
	var quickReplyPayload = quickReply.payload;
	console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
	//send payload to api.ai
	sendToApiAi(senderID, quickReplyPayload);
}

//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
	// Just logging message echoes to console
	console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}


// Handle Api.ai Action
function handleApiAiAction(sender, action, responseText, contexts, parameters, actionIncomplete) {

	let str = action;
    let arr = str.split("_");
    if (arr.length != 2)  return;
    else {
    	let typeq = arr[0];
    	let q = arr[1];

    	if (typeq == "c"){
            // case category
            // query to get all the activities for the category q

			// responseText = "query to get all activities for a category : " + q ;
            // sendTextMessage(sender, responseText);

			sendTextMessage(sender, "Okay!! Let me check what I can do for you!");


            gdb.cypher({

                query: 'MATCH (c:Categoria)-[:HA]-(a:Attività) WHERE c.Nome = {categoryName} return a'
                ,
                params: {
                    categoryName: q
                }

            }, function(err, results){

                // sendTextMessage(sender, "query executed");
                if (err) {
                    //sendTextMessage(sender, "error query");
                    console.error('Error search into database:', err);
                } else {
                    // query executed without error
                    parseSendCardsActivities(results,sender);
                    return;
                }
            });

        }
        else if (typeq == "q"){
			// case quiz
    		if (!actionIncomplete){
    			//sendTextMessage(sender, "action complete");

    			if (parameters.hasOwnProperty("answer1") && parameters["answer1"]!=''
                    && parameters.hasOwnProperty("answer2") && parameters["answer2"]!=''
				) {
    				let answer1 = parameters["answer1"];
    				let answer2 = parameters["answer2"];

                    //sendTextMessage(sender, `your first answer ${parameters["answer1"]}\n your second answer ${parameters["answer2"]}`);
                    sendTextMessage(sender, "your first answer "+ answer1+ "\n your second answer " + answer2 );

                    let arr = q.split("-");
                    if (arr.length != 3)  return;

                    let typequiz= arr[0]; // typequiz can be c for category or s for subcategory
                    let cat= arr[1]; // Name of category
                    let id_quiz = arr[2];  // quiz id, if "cat" has subcategories (typequiz = s) then id quiz = id subcategory, otherwise id quiz will be defined by the user

					// query to get meta-info from a category cat

					gdb.cypher({

						query: 'MATCH (c:Categoria) WHERE c.Nome = {categoryName} return c'	,
						params: { categoryName: cat	}

					}, function(err, results){

						if (err) {
							sendTextMessage(sender, "quiz db error ");
							console.error('Error search into database:', err);
						} else {
							// query executed without error
                            // shows response from neo4j
                                console.log("query response: ")
                                console.log(JSON.stringify(results, null, 4));

                                var result = results[0];
                                if (!result) {
                                    console.log('No category found.');
                                    sendTextMessage(sender, "I'm sorry no category found");
                                } else	{

                                	let str_parameter1= "q"+id_quiz+"_answer1";
                                	let str_parameter2= "q"+id_quiz+"_answer2";

									let dbanswer1 =   isDefined(results[0].c.properties[str_parameter1])?results[0].c.properties[str_parameter1]: [] ;
									let dbanswer2 =   isDefined(results[0].c.properties[str_parameter2])?results[0].c.properties[str_parameter2]: [] ;

                                    console.log("db answer response: "+ dbanswer1 + "\n" + dbanswer2);
                                    if (dbanswer1.length<1 || dbanswer2.length<1  ){
                                        sendTextMessage(sender, "Quiz not implemented yet");
									}
									else {
                                    	let correct_answers = 0;
										correct_answers = checkAnswer(answer1,dbanswer1)+checkAnswer(answer2,dbanswer2);
                                        let newaction = typequiz+"_";
										if(typequiz == "c"){
                                        	newaction+= cat;
                                        }
                                        else if(typequiz =="s"){
                                            newaction+= cat+"-"+id_quiz;
                                        }
                                        console.log("new action: "+newaction);
                                        handleApiAiAction(sender, newaction, responseText, contexts, parameters, actionIncomplete)

										if (correct_answers == 0){
                                            sendTextMessage(sender, "no answers correct, you can improve!");
                                        }
                                        else if (correct_answers == 2) {
                                            sendTextMessage(sender, "Nice all answers are correct!");
                                        }
										else{
                                            sendTextMessage(sender, "Nice some answers are correct!");
										}
									}

								}

                                }


                                return;
					});

                }
			}
        }
    	else if (typeq == "s"){

                // case subcategory

                let arr = q.split("-");
                if (arr.length != 2)  return;

                let cat= arr[0];
                let sub = arr[1];


                // query to get all the activities of subcategory sub of category cat

                responseText = "query to get all activities for a category : " + cat + " subcategory :" + sub ;
                //sendTextMessage(sender, responseText);

                gdb.cypher({

                    query: 'MATCH (c:Categoria)-[:DELLA]-(s:Sottocategoria)-[:HA]-(a:Attività)   WHERE c.Nome = {categoryName} and s.idSC = {subcategoryID}  return a'
                    ,
                    params: {
                        categoryName: cat,
                        subcategoryID: parseInt(sub),
                    }

                }, function(err, results){

                    // sendTextMessage(sender, "query executed");
                    if (err) {
                        //sendTextMessage(sender, "error query");
                        console.error('Error search into database:', err);
                    } else {
                        // query executed without error
                        parseSendCardsActivities(results,sender);
                        return;
                    }
                });





        }
        else if (typeq == "lp"){
			// here we manage the learning path lp
			// query of lp to show only activities of the first step of all learning paths

            var IdCeName = parseInt(q);
            responseText = "query to get all the activities of the first step of all learning paths with IdCe : " + IdCeName ;
            // sendTextMessage(sender, responseText);



            gdb.cypher({

                query:
                    'MATCH (c:Certificato)-[s:SUCCESSIVO]-(e:Elemento)-[:APPARTIENE]->(csc)<-[:HA]-(a:Attività)'+
					' WHERE c.IdCe = {IdCeName}'+
					' RETURN a, id(e) as ids'+
					' UNION '+
					'MATCH (c:Certificato)-[s:SUCCESSIVO]-(e:Elemento)-[:CORRISPONDE]->(a:Attività)' +
					'WHERE c.IdCe = {IdCeName} '+
					'RETURN a, id(e) as ids'
                ,
                params: {
                    IdCeName: IdCeName
                }

            }, function(err, results){

                // sendTextMessage(sender, "query executed");
                if (err) {
                    //sendTextMessage(sender, "error query");
                    console.error('Error search into database:', err);
                } else {
                    // query executed without error
                    parseFirstStepLP(results,sender,IdCeName);
                    return;
                }
            });



        }
    	return
	}

	return ;




	switch (action) {
		case "get-current-weather": // example of third party api

			setTimeout(function() {
			if (parameters.hasOwnProperty("geo-city") && parameters["geo-city"]!='') {

				var request = require('request');

				request({
					url: 'http://api.openweathermap.org/data/2.5/weather', //URL to hit
					qs: {
						appid: config.WEATHER_API_KEY,
						q: parameters["geo-city"]
					}, //Query string data
				}, function(error, response, body){
					if(!error && response.statusCode == 200) {
						let weather = JSON.parse(body);

						if (weather.hasOwnProperty("weather")) {
							console.log(weather);
							//let reply = `${responseText} ${weather["weather"][0]["description"]}`; // quote `
							let reply = `${weather["weather"][0]["description"]}`; // quote `
                            sendTextMessage(sender, reply);
						} else {
                            console.log(weather);
                            sendTextMessage(sender, `No weather forecast available for ${parameters["geo-city"]}`);

						}
					} else {
						console.error(response.error);
					}
				});
			}

			else {
				// sendTextMessage(sender, responseText);
			}

            },2000)

			break;

		case "faq-delivery":
			sendTextMessage(sender, responseText);
			sendTypingOn(sender);

			//ask what user wants to do next
			setTimeout(function() {
				let buttons = [
					{
						type:"web_url",
						url:"https://www.myapple.com/track_order",
						title:"Track my order"
					},
					{
						type:"phone_number",
						title:"Call us",
						payload:"+16505551234",
					},
					{
						type:"postback",
						title:"Keep on Chatting",
						payload:"CHAT"
					}
				];

				sendButtonMessage(sender, "What would you like to do next?", buttons);
			}, 3000)

			break;
		case "detailed-application": // check all the parameters
			if (isDefined(contexts[0]) && contexts[0].name == 'job_application' && contexts[0].parameters) {
				let phone_number = (isDefined(contexts[0].parameters['phone-number'])
				&& contexts[0].parameters['phone-number']!= '') ? contexts[0].parameters['phone-number'] : '';

				let user_name = (isDefined(contexts[0].parameters['user-name'])
				&& contexts[0].parameters['user-name']!= '') ? contexts[0].parameters['user-name'] : '';

				let previous_job = (isDefined(contexts[0].parameters['previous-job'])
				&& contexts[0].parameters['previous-job']!= '') ? contexts[0].parameters['previous-job'] : '';

				let years_of_experience = (isDefined(contexts[0].parameters['years-of-experience'])
				&& contexts[0].parameters['years-of-experience']!= '') ? contexts[0].parameters['years-of-experience'] : '';

				let job_vacancy = (isDefined(contexts[0].parameters['job-vacancy'])
				&& contexts[0].parameters['job-vacancy']!= '') ? contexts[0].parameters['job-vacancy'] : '';

				// if there are all parameters then we can send the email
				if (phone_number != '' && user_name != '' && previous_job != '' && years_of_experience != ''
				&& job_vacancy != '') {
					let emailContent = 'A new job enquiery from ' + user_name + ' for the job: ' + job_vacancy +
							'.<br> Previous job position: ' + previous_job + '.' +
							'.<br> Years of experience: ' + years_of_experience + '.' +
							'.<br> Phone number: ' + phone_number + '.';

					sendEmail('New job application', emailContent);
				}
			}
			sendTextMessage(sender, responseText);
			break;
        case "job-enquiry": //
			let replies = [
				{
					"content_type":"text",
					"title":"Accountant",
					"payload":"Accountant"
				},
				{
					"content_type":"text",
					"title":"Sales",
					"payload":"Sales"
				},
				{
					"content_type":"text",
					"title":"Not interested",
					"payload":"Not interested"
				}
			];
			// sendQuickReply(sender, responseText, replies); // just for old example
			break;

        case "Check_intermediate_math": //
            sendTextMessage(sender, "Results for you!");
            if (parameters.hasOwnProperty("answer1") && parameters["answer1"]!='') {
                sendTextMessage(sender, `your first answer ${parameters["answer1"]}`);
            }
            break;

		case "smalltalk.agent":
			if ( responseText == ''){
                sendTextMessage(sender, "I'm not sure what you want. I'll ask somebody to help me. Ask me something else");

            } else {
				//sendTextMessage(sender, responseText);
			}
			break;
		default:
			//unhandled action, nothing , we send the text response before
			console.log("send response in handle action: " + responseText);
			/*
            if (responseText!= ''){
                sendTextMessage(sender, responseText);

            }
            */

	}
}


function handleMessage(message, sender) { //
	switch (message.type) {
		case 0: //text

			console.log("case 0");
			console.log(message);

			sendTextMessage(sender, message.speech);
			break;
        //
		// case 1: //  Card
		// 	break;

		case 2: //quick replies

            console.log("case 2");
            console.log(message);

			let replies = [];
			for (var b = 0; b < message.replies.length; b++) {
				let reply =
				{
					"content_type": "text",
					"title": message.replies[b],
					"payload": message.replies[b]
				}
				replies.push(reply);
			}
			sendQuickReply(sender, message.title, replies);
			break;
		case 3: //image

            console.log("case 3");
            console.log(message);
			sendImageMessage(sender, message.imageUrl);
			break;
		case 4:

            console.log("case 4");
            console.log(message);
			// custom payload
			var messageData = {
				recipient: {
					id: sender
				},
				message: message.payload.facebook

			};
			console.log('custom payload');
			callSendAPI(messageData);

			break;
	}
}

function handleCardMessages(messages, sender) {
	let elements = [];
	for (var m = 0; m < messages.length; m++) {
		let message = messages[m];
		let buttons = [];
		for (var b = 0; b < message.buttons.length; b++) {
			let isLink = (message.buttons[b].postback.substring(0, 4) === 'http');
			let button;
			if (isLink) {
				button = {
					"type": "web_url",
					"title": message.buttons[b].text,
					"url": message.buttons[b].postback
				}
			} else {
				button = {
					"type": "postback",
					"title": message.buttons[b].text,
					"payload": message.buttons[b].postback
				}
			}
			buttons.push(button);
		}

		// we suppose that at least there is alway a title and an image
        if (buttons.length == 0  && message.subtitle == '' ){
            let element = {
                "title": message.title,
                "image_url":message.imageUrl,

            };
            elements.push(element);
        }
		else if (buttons.length > 0  && message.subtitle == '' ){
            let element = {
                "title": message.title,
                "image_url":message.imageUrl,
                "buttons": buttons
            };
            elements.push(element);
        }
        else if (buttons.length == 0  && message.subtitle != ''){
            let element = {
                "title": message.title,
                "image_url":message.imageUrl,
                "subtitle": message.subtitle

            };
            elements.push(element);
        }
        else {


		let element = {
			"title": message.title,
			"image_url":message.imageUrl,
			"subtitle": message.subtitle,
			"buttons": buttons
		};
		elements.push(element);
        }
	}
	sendGenericMessage(sender, elements);
}

function handleApiAiResponse(sender, response) {
	let responseText = response.result.fulfillment.speech;
	let responseData = response.result.fulfillment.data;
	let messages = response.result.fulfillment.messages; // list of messages
	let action = response.result.action;
	let actionIncomplete = response.result.actionIncomplete;
	let contexts = response.result.contexts;
	let parameters = response.result.parameters;
	
	sendTypingOff(sender);

	if (isDefined(messages) && messages.length >= 1) {
		let timeoutInterval = 1500;
		let previousType ;
		let cardTypes = [];
		let timeout = 0;
		for (var i = 0; i < messages.length; i++) {

            if (previousType == 1 && messages[i].type != 1 || i == messages.length - 1) {
                //if (the current message is not a card and there is a previous one that is a card) or is the last one message
                if (messages[i].type == 1){
                    cardTypes.push(messages[i]);
                }

                var t = i -1;
                if (t<0){t= t*(-1);}

                timeout = t * timeoutInterval;
                if (cardTypes.length > 0) {

                        setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
                	// else single card

                    cardTypes = [];
                }

                if (messages[i].type != 1) {
                    timeout = i * timeoutInterval;
                    setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
                }
            }

			else if (messages[i].type == 1){
				cardTypes.push(messages[i]);
			}
			else {
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			}

			previousType = messages[i].type;

		}

	}

	else if (responseText == '' && !isDefined(action)) {
		//api ai could not evaluate input.
		console.log('Unknown query' + response.result.resolvedQuery);
		sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
	}

	else if (isDefined(responseData) && isDefined(responseData.facebook)) {
		try {
			console.log('Response as formatted message' + responseData.facebook);
			sendTextMessage(sender, responseData.facebook);
		} catch (err) {
			sendTextMessage(sender, err.message);
		}
	} else if (isDefined(responseText)) {
		console.log('Respond as text message');
		sendTextMessage(sender, responseText);
	}


    if (isDefined(action)) {
        handleApiAiAction(sender, action, responseText, contexts, parameters,actionIncomplete);
	}


}

function sendToApiAi(sender, text) {

	sendTypingOn(sender);
	let apiaiRequest = apiAiService.textRequest(text, {
		sessionId: sessionIds.get(sender)
	});

	apiaiRequest.on('response', (response) => {
		if (isDefined(response.result)) {
			handleApiAiResponse(sender, response);
		}
	});

	apiaiRequest.on('error', (error) => console.error(error));
	apiaiRequest.end();
}




function sendTextMessage(recipientId, text) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text
		}
	}
	callSendAPI(messageData);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, imageUrl) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: imageUrl
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: config.SERVER_URL + "/assets/instagram_logo.gif"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "audio",
				payload: {
					url: config.SERVER_URL + "/assets/sample.mp3"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example videoName: "/assets/allofus480.mov"
 */
function sendVideoMessage(recipientId, videoName) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "video",
				payload: {
					url: config.SERVER_URL + videoName
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example fileName: fileName"/assets/test.txt"
 */
function sendFileMessage(recipientId, fileName) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "file",
				payload: {
					url: config.SERVER_URL + fileName
				}
			}
		}
	};

	callSendAPI(messageData);
}



/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId, text, buttons) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: text,
					buttons: buttons
				}
			}
		}
	};

	callSendAPI(messageData);
}


function sendGenericMessage(recipientId, elements) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "generic",
					elements: elements
				}
			}
		}
	};

	callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
							timestamp, elements, address, summary, adjustments) {
	// Generate a random receipt ID as the API requires a unique ID
	var receiptId = "order" + Math.floor(Math.random() * 1000);

	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "receipt",
					recipient_name: recipient_name,
					order_number: receiptId,
					currency: currency,
					payment_method: payment_method,
					timestamp: timestamp,
					elements: elements,
					address: address,
					summary: summary,
					adjustments: adjustments
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, text, replies, metadata) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text,
			metadata: isDefined(metadata)?metadata:'',
			quick_replies: replies
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {
	console.log("Sending a read receipt to mark message as seen");

	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "mark_seen"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {
	console.log("Turning typing indicator on");

	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_on"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {
	console.log("Turning typing indicator off");

	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_off"
	};

	callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: "Welcome. Link your account.",
					buttons: [{
						type: "account_link",
						url: config.SERVER_URL + "/authorize"
          }]
				}
			}
		}
	};

	callSendAPI(messageData);
}


function greetUserText(userId) {

	let user = userMap.get(userId);

	sendTextMessage(userId, "Welcome " + user.first_name + '! ' +
	'I can answer frequently asked questions for you ' +
	'and I perform job interviews. What can I help you with?');
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {  // send data to fb
	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: {
			access_token: config.FB_PAGE_TOKEN
		},
		method: 'POST',
		json: messageData

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var recipientId = body.recipient_id;
			var messageId = body.message_id;

			if (messageId) {
				console.log("Successfully sent message with id %s to recipient %s",
					messageId, recipientId);
			} else {
				console.log("Successfully called Send API for recipient %s",
					recipientId);
			}
		} else {
			console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
		}
	});
}



/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfPostback = event.timestamp;

    setSessionAndUser(senderID);// to db data always availble


	// The 'payload' param is a developer-defined field which is set in a postback
	// button for Structured Messages. 
	var payload = event.postback.payload;

    let arr = payload.split("_");
    if (arr[0] == "Ns"){ //case next step
    	let num = parseInt(arr[1]);
        let IdCe = parseInt(arr[2]);
        let idA = parseInt(arr[3]);
        let idpaths = arr[4];
		num++;
        // sendTextMessage(senderID, "Activity chosed has idA: " + idA );
        // sendTextMessage(senderID, "Certificate chosed has IdCe: " + IdCe );
        sendTextMessage(senderID, "Step: " + num );
        sendTypingOn(senderID);

		let numprec= num - 1;
        // mega query
        gdb.cypher({

            query:
                'MATCH (e:Elemento)-[:SUCCESSIVO*'+numprec+'..'+numprec+']->(:Elemento)-[:CORRISPONDE]-(a) '+
        		'WHERE  id(e) in ['+ idpaths +'] ' +
        		'RETURN a , id(e) as ids ' +
        		'UNION '+
        		'MATCH (e:Elemento)-[:SUCCESSIVO*'+numprec+'..'+numprec+']->(:Elemento)-[:APPARTIENE]->(csc)<-[:HA]-(a) ' +
        		'WHERE id(e) in ['+ idpaths +'] ' +
        		'return a , id(e) as ids '
			,
            params: {

            }

        }, function(err, results){
            sendTypingOff(senderID);
            // sendTextMessage(senderID, "query executed");
            if (err) {
                //sendTextMessage(sender, "error query");
                console.error('Error search into database:', err);
            } else {
                // query executed without error
                parseNStepLP(results,senderID,IdCe,num);
                return;
            }
        });

		return;
    }





        switch (payload) {

        case 'No_website_available':
            sendTextMessage(senderID, "Thank you for your feedback.\n We will use your feedback for future improvement.");
            break;

		case 'GET_STARTED':
			greetUserText(senderID);
			break;


		case 'JOB_APPLY':
			//get feedback with new jobs
			sendToApiAi(senderID, "job openings");
			break;
		case 'CHAT':
			//user wants to chat
			sendTextMessage(senderID, "I love chatting too. Do you have any other questions for me?");
			break;
		default:
			//unindentified payload
			sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
			break;

	}
	console.log("payload: " + payload);
	console.log("Received postback for user %d and page %d with payload '%s' " +
		"at %d", senderID, recipientID, payload, timeOfPostback);

}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	// All messages before watermark (a timestamp) or sequence have been seen.
	var watermark = event.read.watermark;
	var sequenceNumber = event.read.seq;

	console.log("Received message read event for watermark %d and sequence " +
		"number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 * 
 */
function receivedAccountLink(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	var status = event.account_linking.status;
	var authCode = event.account_linking.authorization_code;

	console.log("Received account link event with for user %d with status %s " +
		"and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var delivery = event.delivery;
	var messageIDs = delivery.mids;
	var watermark = delivery.watermark;
	var sequenceNumber = delivery.seq;

	if (messageIDs) {
		messageIDs.forEach(function (messageID) {
			console.log("Received delivery confirmation for message ID: %s",
				messageID);
		});
	}

	console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfAuth = event.timestamp;

	// The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
	// The developer can set this to an arbitrary value to associate the 
	// authentication callback with the 'Send to Messenger' click event. This is
	// a way to do account linking when the user clicks the 'Send to Messenger' 
	// plugin.
	var passThroughParam = event.optin.ref;

	console.log("Received authentication for user %d and page %d with pass " +
		"through param '%s' at %d", senderID, recipientID, passThroughParam,
		timeOfAuth);

	// When an authentication is received, we'll send a message back to the sender
	// to let them know it was successful.
	sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
	var signature = req.headers["x-hub-signature"];

	if (!signature) {
		throw new Error('Couldn\'t validate the signature.');
	} else {
		var elements = signature.split('=');
		var method = elements[0];
		var signatureHash = elements[1];

		var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
			.update(buf)
			.digest('hex');

		if (signatureHash != expectedHash) {
			throw new Error("Couldn't validate the request signature.");
		}
	}
}

function sendEmail(subject, content) {

	/*
	var helper = require('sendgrid').mail;

	var from_email = new helper.Email(config.EMAIL_FROM);
	var to_email = new helper.Email(config.EMAIL_TO);
	var subject = subject;
	var content = new helper.Content("text/html", content);
	var mail = new helper.Mail(from_email, subject, to_email, content);

	var sg = require('sendgrid')(config.SENGRID_API_KEY);
	var request = sg.emptyRequest({
		method: 'POST',
		path: '/v3/mail/send',
		body: mail.toJSON()
	});

	sg.API(request, function(error, response) {
		console.log(response.statusCode)
		console.log(response.body)
		console.log(response.headers)
	})
	*/
}

function isDefined(obj) {
	if (typeof obj == 'undefined') {
		return false;
	}

	if (!obj) {
		return false;
	}

	return obj != null;
}


function checkAnswer(answer,dbanswer){
	// check if the array dbanswer contains answer, if yes the answer is correct, so return 1, otherwhise 0 .
    if (dbanswer.findIndex(item => answer.toLowerCase() === item.toLowerCase()) == -1) {return 0;}
    else {return 1;}


}


function parseSendCardsActivities(results,sender) {

    // shows all the answers from neo4j
    console.log("query response: ")
    console.log(JSON.stringify(results, null, 4));



    var result = results[0];
    if (!result) {
        console.log('No activities found.');
        sendTextMessage(sender, "I'm sorry no results");
    } else	{

        // arrary of cards
        let elements = [];
        for(var i =0; i< results.length; i++){
            // for each node we have one image, link, title and subtitle

            // one button for the website
            let buttons = [];
            let button;
            // check if there is a valid url
            if (isDefined(results[i].a.properties.website)) {
                let isLink = (results[i].a.properties.website.substring(0, 4) === 'http');
                if (isLink) {
                    button = {
                        "type": "web_url",
                        "title": "View website",
                        "url": results[i].a.properties.website
                    }
                }

            } else {
                button = {
                    "type": "postback",
                    "title": "No website available",
                    "payload": "No_website_available", // because Payload cannot be empty for postback type button
                }
            }
            buttons.push(button);

            // title, subtitle and image

            let title =   isDefined(results[i].a.properties.Nome)?results[i].a.properties.Nome: "Name missing";
            let imageUrl =   isDefined(results[i].a.properties.url_image)?results[i].a.properties.url_image: "https://integreatbot.herokuapp.com/refugees.jpg";
            let subtitle =   isDefined(results[i].a.properties.desc)?results[i].a.properties.desc: "Description missing";

            let element = {
                "title": title,
                "subtitle": subtitle,
                "image_url": imageUrl,
                "buttons": buttons
            };
            elements.push(element);
        }
        sendGenericMessage(sender, elements);

    }


}

function parseFirstStepLP(results,sender, IdCeName) {

    // shows all the answers from neo4j
    console.log("query response: ")
    console.log(JSON.stringify(results, null, 4));



    var result = results[0];
    if (!result) {

        console.log('No Learning paths found.');
        sendTextMessage(sender, "No Learning paths found.");
    } else	{
        sendTextMessage(sender, "First step");
        // array of cards
        let elements = [];
		let activities_map = {};
        for(var i =0; i< results.length; i++){//dictionary to remove duplicates
            if (!activities_map[results[i].a.properties.idA]) {
                activities_map[results[i].a.properties.idA] = [];
            }
            activities_map[results[i].a.properties.idA].push(results[i].ids);
		}

        console.log(activities_map);

 		for(var i =0; i< results.length; i++){

            if( activities_map[results[i].a.properties.idA] ){

 		    // for each node we have one image, link, title and subtitle
            // one button for the website
            let buttons = [];
            let button;
            // check if there is a valid url
            if (isDefined(results[i].a.properties.website)) {
                let isLink = (results[i].a.properties.website.substring(0, 4) === 'http');
                if (isLink) {
                    button = {
                        "type": "web_url",
                        "title": "View website",
                        "url": results[i].a.properties.website
                    }
                }

            } else {
                button = {
                    "type": "postback",
                    "title": "No website available",
                    "payload": "No_website_available", // because Payload cannot be empty for postback type button
                }
            }
            buttons.push(button);

            var paths = activities_map[results[i].a.properties.idA].join(",");
            console.log(paths);
            delete activities_map[results[i].a.properties.idA];

            button = {
                "type": "postback",
                "title": "Next step",
                "payload": "Ns_1_"+IdCeName+"_"+results[i].a.properties.idA+"_"+paths,
            }
            buttons.push(button);

            // title, subtitle and image

            let title =   isDefined(results[i].a.properties.Nome)?results[i].a.properties.Nome: "Name missing";
            let imageUrl =   isDefined(results[i].a.properties.url_image)?results[i].a.properties.url_image: "https://integreatbot.herokuapp.com/refugees.jpg";
            let subtitle =   isDefined(results[i].a.properties.desc)?results[i].a.properties.desc: "Description missing";

            let element = {
                "title": title,
                "subtitle": subtitle,
                "image_url": imageUrl,
                "buttons": buttons
            };
            elements.push(element);
            }
        }
        sendGenericMessage(sender, elements);

    }


}

function parseNStepLP(results,senderID, IdCeName, n ) {

    // shows all the answers from neo4j
    console.log("query response: ")
    console.log(JSON.stringify(results, null, 4));



    var result = results[0];
    if (!result) {

        console.log('No more step');
        sendTextMessage(senderID, "This is the end, no more step");
    } else	{

        // array of cards
        let elements = [];
        let activities_map = {};
        for(var i =0; i< results.length; i++){
            if (!activities_map[results[i].a.properties.idA]) {
                activities_map[results[i].a.properties.idA] = [];
            }
            activities_map[results[i].a.properties.idA].push(results[i].ids);
        }

        console.log(activities_map);




        for(var i =0; i< results.length; i++){
            if(activities_map[results[i].a.properties.idA])
            {
				// for each node we have one image, link, title and subtitle
				// one button for the website
				let buttons = [];
				let button;
				// check if there is a valid url
				if (isDefined(results[i].a.properties.website)) {
					let isLink = (results[i].a.properties.website.substring(0, 4) === 'http');
					if (isLink) {
						button = {
							"type": "web_url",
							"title": "View website",
							"url": results[i].a.properties.website
						}
					}

				} else {
					button = {
						"type": "postback",
						"title": "No website available",
						"payload": "No_website_available", // because Payload cannot be empty for postback type button
					}
				}
				buttons.push(button);

                var paths = activities_map[results[i].a.properties.idA].join(",");
                console.log(paths);
                delete activities_map[results[i].a.properties.idA];

				button = {
					"type": "postback",
					"title": "Next step",
					"payload": "Ns_"+ n +"_"+IdCeName+"_"+results[i].a.properties.idA+"_"+paths,
				}
				buttons.push(button);

				// title, subtitle and image

				let title =   isDefined(results[i].a.properties.Nome)?results[i].a.properties.Nome: "Name missing";
				let imageUrl =   isDefined(results[i].a.properties.url_image)?results[i].a.properties.url_image: "https://integreatbot.herokuapp.com/refugees.jpg";
				let subtitle =   isDefined(results[i].a.properties.desc)?results[i].a.properties.desc: "Description missing";

				let element = {
					"title": title,
					"subtitle": subtitle,
					"image_url": imageUrl,
					"buttons": buttons
				};
				elements.push(element);
        	}
        }
        sendGenericMessage(senderID, elements);

    }


}



// Spin up the server
app.listen(app.get('port'), function () {
	console.log('running on port', app.get('port'))
})
