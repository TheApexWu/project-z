const beginOrderCommandCallback = async ({ ack, respond, logger }) => {
  try {
    await ack();
    await respond('Group Grub is ready. Order creation will be enabled with the orchestrator.');
  } catch (error) {
    logger.error(error);
  }
};

export { beginOrderCommandCallback };
