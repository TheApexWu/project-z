I have a long-winded and advanced project I need you to make. Before you get
started on the project, you need to ensure that you have ways to verify that
what you've built works. Along the way, you need to verify that each part you
are building works and will end up as one cohesive project.

We are working on a hackathon project for the company rain.xyz and monad crypto
coin. The theme is agentic commerce as well as developer tooling,
infrastructure, AI, and commerce. We aim for the first prize with Rain, and we
also aim for the bounty of Best Implementation of Monad.

I want you to create a PRD.JSON with steps used to create this entire
application. You should include individual milestones and ways to verify that
each milestone was completed. The PRD should include information about the
entire context of what the application is being built, since it is going to be
read on every loop of the Ralph loop.

You have a supply of API keys that are required to pull the information you
need. You are also equipped with an MCP server and a command line tool for
Railway, which is where you will be deploying all of your resources.

This tool is largely going to be written by an AI agent. For that reason, Do not
write an exhaustive test suite, only include stuff that would require testing
upon multiple runs. Keep comments only required for the next iteration of the
Ralph Loop, as no human is going to be reading the comments.

The first step of the PRD should always be to verify that you have the correct
tools, environment variables, and API keys that you need to run the project. You
should also test those to make sure that they work before going on to the next
step.

The absolute last step should be taking a full end-to-end test. You are an agent
and this does require some human input, but you should be able to figure out a
meaningful way to mock and imiated human input to ensure this works before
handoff.

Resources:

- https://www.rain.xyz/resources/introducing-the-agent-control-layer
- https://docs.x402.org/llms.txt
- https://www.getfoundry.sh/llms.txt
- https://rain-sandbox-trial.mintlify.site
- https://api-dev.raincards.xyz/v1
- https://docs.slack.dev/llms.txt
- https://developer.doordash.com/en-US/api/drive
- https://developer.doordash.com/en-US/docs/drive/overview/about_drive/
- https://goose-docs.ai/llms.txt

You will be building the agents with these tools:

- Docker Base Image: `ghcr.io/aaif-goose/goose:sha-86eec2a`
- OpenRouter Model ID: `z-ai/glm-5.2`
- Railway Project: `17b87956-a6e5-4dee-b0fc-21c383c922c2`

We're building a Slack bot that can facilitate multiple people We're doing food
from the same location under a budget where each person gets part of a
sub-budget. The admin will open up an order for any amount of money at a
specific restaurant on Doordash, and he will add people to the order as he
chooses.

Once the admin has initiated an order, a message will appear inside a specified
channel by the admin saying that a group order has been announced. We will
internally call this announcement menu. The group order has now been created,
and it will wait for every person to finish their order or for a timer. The
admin can set the timer limits.

The admin initiates the order through Slack commands. It could be something as
simple as: `/begin order` - a list of users - a price of how much they would
like the order to be - a location of where they would like the order to take
place (for example, McDonald's, Burger King, or Applebee's). It will be the
agents best jurisdiction as to what the user expected to order

Each participant will get a message in Slack from an agent asking them what they
would like to order.

Each person will get a fair share of the budget In which they will get a message
from an agent which will facilitate their ordering. The agent will be able to
list items they're able to order and add items to the order. The user can talk
to the agent and look for items to order or even maybe ask for suggestions. The
agent will always try to work within the constraints of the budget that they've
been given and, if not, suggest items they can remove.

Once the agent has confirmed an order, it will give them a prompt if that's what
they would like to order. If they say yes, then the order will be submitted. If
not, the agent will work with them again to figure out what they would like to
order within the budget's constraints. If the user has confirmed but the
complete group order hasn't completed, they are still able to go back and change
the order.

After the user has confirmed the agent's order, the announcement message will be
updating, saying this person has confirmed their order. Once all users have
confirmed their order and the timer has finished, or the timer has finished A
mint card for the amount of money specified for the order will get minted, and
that will be used through browser base and Doordash to submit that order.
Something to note is that when all users finish or the timer ends, there is
always a 2-minute grace period where users can change and modify their order.
After the grace period, that is when you mint the card, and then you begin to
use browser-based access to Doordash to complete the order.

This is a hackathon project, so the authorization will be very easy. We're going
to use a very basic HTTP auth for the admin panel. The user name should be
`carson`, and the password should be `1234`.

The admin should be able to enter their client rules with RAIN so they're able
to make cards. They should also be able to set the address. Through this admin
panel, they are also able to select who is an admin and who has the right to
create new order requests. For security reasons, no order is ever going to be
able to create it over $300.

We will have a seperate page where ...

Tech stack being used is:

- You're going to be using the latest version of Go.
- You're going to be using Kubernetes to host each agent for each individual
  person.
- You're going to be using rain.xyz.
- You're going to be hosting all of this inside of Railway, in which you have an
  MCP server which we're allowed to access and modify whenever you see need.
- You're also going to be using browser base.
- Postgres, as well as any other resources you need from Railway
- Vite, Node, and React to deploy this application's frontend, as well as any
  dependencies you feel as you need.

Thing to note is that all the RAIN cards are dummy cards and will not actually
complete the order. However, this is okay, and in fact we want a separate
feature of this application so that we have proof that the order attemped to go
through but was declined.

The Doordash api is in fact a sandbox api. So no real orders will actually be
made.

We have included a dataset with a list of resturant data and prices as well

You have the slack cli already installed with a valid credential already logged
in.

You also have kubectl installed with a valid certificate. I've included a
sperate git ignored certificate in the git repo too. You have three nodes you
are allowed to use.

You have an image registry at registry.digitalocean.com/rainxyzhackathon2026
